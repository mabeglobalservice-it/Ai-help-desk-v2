import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { getRedisConnectionOptions } from '../notifications-delivery/redis-connection.util';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Délai dépassé (${ms}ms)`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// docs/14-plan-deploiement-cloud.md §8 : health check consomme par le
// healthCheckPath Render du service backend (voir render.yaml) — un 503 ici
// declenche un redemarrage automatique du service par Render.
//
// Redis est verifie mais volontairement exclu du check terminus (qui
// determine le code HTTP) : c'est une dependance optionnelle degradee
// gracieusement partout ailleurs (RM-05, voir redis-connection.util.ts) —
// la rendre bloquante ici ferait redemarrer un backend parfaitement
// fonctionnel juste parce que Redis est indisponible. Son statut reste
// visible dans la reponse, juste non gatant.
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    const result = await this.health.check([() => this.checkDatabase()]);
    return {
      ...result,
      info: { ...result.info, redis: await this.checkRedis() },
    };
  }

  private async checkDatabase() {
    const indicator = this.healthIndicatorService.check('database');
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async checkRedis(): Promise<{ status: 'up' | 'down' }> {
    const client = new Redis({
      ...getRedisConnectionOptions(),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    client.on('error', () => {
      // evite un crash process sur une erreur de connexion non geree
      // pendant le ping ci-dessous (meme raison que
      // NotificationsDeliveryService.queue.on('error', ...)).
    });
    try {
      await withTimeout(
        client.connect().then(() => client.ping()),
        1000,
      );
      return { status: 'up' };
    } catch {
      return { status: 'down' };
    } finally {
      client.disconnect();
    }
  }
}
