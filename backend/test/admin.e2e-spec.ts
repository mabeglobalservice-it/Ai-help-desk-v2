import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

// docs/11-documentation-api.md §12 (Module Administration), docs/06-cas-
// utilisation.md UC-030 : reserve a l'Admin. Microsoft Graph et Intune n'ont
// pas d'integration reelle dans ce projet (docs/03 §3.4/§3.5) et sont
// declares tels quels par GET /admin/integrations.
describe('Admin (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const employeeEmail = 'e2e-admin-employee@test.com';
  const adminEmail = 'e2e-admin-admin@test.com';
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
          displayName: 'E2E Admin Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          displayName: 'E2E Admin Admin',
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
    // Restore the singleton/toggle rows to their seeded defaults so this
    // file's mutations don't leak into other e2e files sharing the same
    // dev database (same lesson as ai-agents.e2e-spec.ts restoring CLAUDE
    // as the active provider).
    await prisma.systemSettings.upsert({
      where: { id: 'singleton' },
      update: { organizationName: 'AI Help Desk', maxClarifyingTurns: 3 },
      create: { id: 'singleton' },
    });
    await prisma.integrationConfig.updateMany({ data: { isEnabled: true } });

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

  describe('GET/PATCH /admin/settings', () => {
    it('rejects a non-admin on both routes', async () => {
      await apiRequest(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
      await apiRequest(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ organizationName: 'Nope' })
        .expect(403);
    });

    it('returns the seeded singleton settings for an admin', async () => {
      const res = await apiRequest(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.organizationName).toEqual(expect.any(String));
      expect(res.body.maxClarifyingTurns).toEqual(expect.any(Number));
    });

    it('updates the settings and persists the change', async () => {
      const updated = await apiRequest(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ organizationName: 'E2E Test Org', maxClarifyingTurns: 7 })
        .expect(200);

      expect(updated.body.organizationName).toBe('E2E Test Org');
      expect(updated.body.maxClarifyingTurns).toBe(7);

      const reread = await apiRequest(app)
        .get('/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(reread.body.organizationName).toBe('E2E Test Org');
    });

    it('rejects an out-of-range maxClarifyingTurns', async () => {
      await apiRequest(app)
        .patch('/admin/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ maxClarifyingTurns: 0 })
        .expect(400);
    });
  });

  describe('GET/PATCH /admin/integrations', () => {
    it('rejects a non-admin on both routes', async () => {
      await apiRequest(app)
        .get('/admin/integrations')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
      await apiRequest(app)
        .patch('/admin/integrations/TEAMS')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ isEnabled: false })
        .expect(403);
    });

    it('lists Teams/Slack/Email/IA and declares Graph/Intune as not implemented', async () => {
      const res = await apiRequest(app)
        .get('/admin/integrations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const names = res.body.map((i: any) => i.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'TEAMS',
          'SLACK',
          'EMAIL',
          'IA',
          'MICROSOFT_GRAPH',
          'INTUNE',
        ]),
      );
      const graph = res.body.find((i: any) => i.name === 'MICROSOFT_GRAPH');
      expect(graph.configured).toBe(false);
      expect(graph.enabled).toBe(false);
    });

    it('toggles an integration off and back on', async () => {
      const disabled = await apiRequest(app)
        .patch('/admin/integrations/TEAMS')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isEnabled: false })
        .expect(200);
      expect(disabled.body.isEnabled).toBe(false);

      const list = await apiRequest(app)
        .get('/admin/integrations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(list.body.find((i: any) => i.name === 'TEAMS').enabled).toBe(
        false,
      );

      const reenabled = await apiRequest(app)
        .patch('/admin/integrations/TEAMS')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isEnabled: true })
        .expect(200);
      expect(reenabled.body.isEnabled).toBe(true);
    });

    it('rejects toggling Microsoft Graph or Intune (not implemented)', async () => {
      await apiRequest(app)
        .patch('/admin/integrations/MICROSOFT_GRAPH')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isEnabled: true })
        .expect(400);
    });
  });
});
