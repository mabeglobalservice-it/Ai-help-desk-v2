import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

// docs/11-documentation-api.md §6 : administration des agents IA et du
// fournisseur actif, reservee a l'Admin.
describe('AiAgents (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const employeeEmail = 'e2e-ai-agents-employee@test.com';
  const adminEmail = 'e2e-ai-agents-admin@test.com';
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
          displayName: 'E2E AiAgents Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          displayName: 'E2E AiAgents Admin',
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

  describe('GET /ai/agents', () => {
    it('rejects a non-admin', async () => {
      await apiRequest(app)
        .get('/ai/agents')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('lists the seeded agent registry for an admin', async () => {
      const res = await apiRequest(app)
        .get('/ai/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const names = res.body.map((agent: any) => agent.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'DIAGNOSTIC',
          'DOCUMENTATION',
          'AUTOMATION',
          'SUPERVISOR',
          'INVENTORY',
          'HELPDESK',
        ]),
      );
    });
  });

  describe('PATCH /ai/agents/:id/toggle', () => {
    it('rejects a non-admin', async () => {
      const list = await apiRequest(app)
        .get('/ai/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const agentId = list.body[0].id;

      await apiRequest(app)
        .patch(`/ai/agents/${agentId}/toggle`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('flips isActive and flips it back', async () => {
      const list = await apiRequest(app)
        .get('/ai/agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const agent = list.body.find((a: any) => a.name === 'DIAGNOSTIC');

      const toggled = await apiRequest(app)
        .patch(`/ai/agents/${agent.id}/toggle`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(toggled.body.isActive).toBe(!agent.isActive);

      const restored = await apiRequest(app)
        .patch(`/ai/agents/${agent.id}/toggle`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(restored.body.isActive).toBe(agent.isActive);
    });

    it('returns 404 for an unknown agent id', async () => {
      await apiRequest(app)
        .patch('/ai/agents/00000000-0000-0000-0000-000000000000/toggle')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('GET /ai/providers and PATCH /ai/providers/active', () => {
    afterAll(async () => {
      // Restore CLAUDE as the active provider so it doesn't leak into
      // other e2e files that exercise the real AI diagnosis path.
      await apiRequest(app)
        .patch('/ai/providers/active')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'CLAUDE' });
    });

    it('rejects a non-admin on both routes', async () => {
      await apiRequest(app)
        .get('/ai/providers')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
      await apiRequest(app)
        .patch('/ai/providers/active')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ provider: 'OPENAI' })
        .expect(403);
    });

    it('lists the seeded providers with exactly one active', async () => {
      const res = await apiRequest(app)
        .get('/ai/providers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const names = res.body.map((p: any) => p.provider);
      expect(names).toEqual(
        expect.arrayContaining(['CLAUDE', 'OPENAI', 'AZURE_OPENAI']),
      );
      expect(res.body.filter((p: any) => p.isActive)).toHaveLength(1);
    });

    it('switches the active provider, deactivating the previous one', async () => {
      await apiRequest(app)
        .patch('/ai/providers/active')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'OPENAI' })
        .expect(200);

      const res = await apiRequest(app)
        .get('/ai/providers')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const byProvider = Object.fromEntries(
        res.body.map((p: any) => [p.provider, p.isActive]),
      );
      expect(byProvider.OPENAI).toBe(true);
      expect(byProvider.CLAUDE).toBe(false);
      expect(byProvider.AZURE_OPENAI).toBe(false);
    });

    it('rejects an unknown provider value', async () => {
      await apiRequest(app)
        .patch('/ai/providers/active')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ provider: 'CHATGPT' })
        .expect(400);
    });
  });
});
