import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    // @nestjs/schedule never stops its registered cron jobs on app.close()
    // (SLA breach check, refresh-token purge) — their timers otherwise keep
    // the process alive past teardown, which can make Jest force-exit a
    // worker mid-test and corrupt shared DB state for whichever e2e file
    // was running at the time.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });
});
