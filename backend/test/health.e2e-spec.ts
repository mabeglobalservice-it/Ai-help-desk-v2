import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { apiRequest } from './support/api-request';

// docs/14-plan-deploiement-cloud.md §8 : consomme par le healthCheckPath
// Render du service backend (voir render.yaml).
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('/api/v1/health (GET) reports the database as up against a real connection, unauthenticated', async () => {
    const res = await apiRequest(app).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.info.database).toEqual({ status: 'up' });
    // Redis n'est pas force present dans cet environnement de test (voir
    // backend-tests.yml) : on verifie juste que le champ existe et ne fait
    // jamais echouer le check global (RM-05), pas sa valeur precise.
    expect(['up', 'down']).toContain(res.body.info.redis.status);
  });

  afterEach(async () => {
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });
});
