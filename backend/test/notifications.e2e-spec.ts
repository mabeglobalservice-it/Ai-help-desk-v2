import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

// docs/11-documentation-api.md §10 : module Notifications — la liste des
// modeles de notification est reservee a l'Admin.
describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const employeeEmail = 'e2e-notifications-employee@test.com';
  const adminEmail = 'e2e-notifications-admin@test.com';
  const password = 'CorrectHorseBattery1!';

  let employeeId: string;
  let adminId: string;
  let employeeToken: string;
  let adminToken: string;

  async function loginAs(email: string): Promise<string> {
    const res = await apiRequest(app)
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const [employee, admin] = await Promise.all([
      prisma.user.create({
        data: {
          email: employeeEmail,
          passwordHash,
          displayName: 'E2E Notifications Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          displayName: 'E2E Notifications Admin',
          role: Role.ADMIN,
          isActive: true,
        },
      }),
    ]);
    employeeId = employee.id;
    adminId = admin.id;

    [employeeToken, adminToken] = await Promise.all([
      loginAs(employeeEmail),
      loginAs(adminEmail),
    ]);
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [employeeEmail, adminEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [employeeId, adminId].filter(Boolean) } },
    });
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });

  describe('GET /notifications/templates', () => {
    it('rejects a non-admin', async () => {
      await apiRequest(app)
        .get('/notifications/templates')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('lists one template per NotificationType for an admin', async () => {
      const res = await apiRequest(app)
        .get('/notifications/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const types = res.body.map((template: any) => template.type);
      expect(types).toEqual(
        expect.arrayContaining([
          'TICKET_ASSIGNED',
          'NEW_COMMENT',
          'STATUS_CHANGED',
          'SLA_BREACHED',
          'APPROVAL_REQUESTED',
          'AUTOMATION_DECIDED',
        ]),
      );
      for (const template of res.body) {
        expect(typeof template.emailSubject).toBe('string');
        expect(Array.isArray(template.channels)).toBe(true);
        expect(template.channels.length).toBeGreaterThan(0);
      }
    });
  });

  describe('GET /notifications', () => {
    it('is still open to any authenticated role (unaffected by the new admin-only route)', async () => {
      const res = await apiRequest(app)
        .get('/notifications')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
