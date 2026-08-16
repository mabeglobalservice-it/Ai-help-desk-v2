import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

const mockRedisInstances: Array<{
  connect: jest.Mock;
  ping: jest.Mock;
  disconnect: jest.Mock;
  on: jest.Mock;
}> = [];

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      const instance = {
        connect: jest.fn().mockResolvedValue(undefined),
        ping: jest.fn().mockResolvedValue('PONG'),
        disconnect: jest.fn(),
        on: jest.fn(),
      };
      mockRedisInstances.push(instance);
      return instance;
    }),
  };
});

// docs/14-plan-deploiement-cloud.md §8.
describe('HealthController', () => {
  let controller: HealthController;
  let prisma: { $queryRaw: jest.Mock };
  let healthCheckService: { check: jest.Mock };

  beforeEach(async () => {
    mockRedisInstances.length = 0;
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    healthCheckService = {
      check: jest
        .fn()
        .mockImplementation(async (indicators: Array<() => unknown>) => {
          const info: Record<string, unknown> = {};
          for (const indicator of indicators) {
            const result = (await indicator()) as Record<
              string,
              { status: string }
            >;
            Object.assign(info, result);
          }
          return { status: 'ok', info, error: {}, details: info };
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: healthCheckService },
        HealthIndicatorService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('reports the database as up when the ping query succeeds', async () => {
    const result = await controller.check();

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect((result.info as any).database).toEqual({ status: 'up' });
  });

  it('reports the database as down (and does not throw from the indicator itself) when the ping query fails', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

    const result = await controller.check();

    expect((result.info as any).database.status).toBe('down');
  });

  it('reports redis as up when it responds to ping within the timeout, without gating the overall check', async () => {
    const result = await controller.check();

    expect(mockRedisInstances[0].connect).toHaveBeenCalled();
    expect(mockRedisInstances[0].ping).toHaveBeenCalled();
    expect(mockRedisInstances[0].disconnect).toHaveBeenCalled();
    expect((result.info as any).redis).toEqual({ status: 'up' });
  });

  // RM-05 : Redis est optionnel partout ailleurs dans l'app — le check
  // global ne doit jamais echouer juste parce que Redis est indisponible.
  it('reports redis as down without throwing when it never responds', async () => {
    const Redis = jest.requireMock('ioredis').default;
    Redis.mockImplementationOnce(() => ({
      connect: jest.fn(() => new Promise(() => {})), // never resolves
      ping: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
    }));

    const result = await controller.check();

    expect((result.info as any).redis).toEqual({ status: 'down' });
  }, 10000);
});
