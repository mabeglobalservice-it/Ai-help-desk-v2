import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

// docs/11-documentation-api.md §5 (module Diagnostics : historique et
// feedback d'une conversation) et §6 (GET /ai/conversations/:id/cost),
// docs/08-architecture-ia.md §4.4.
describe('Diagnostics (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const ownerEmail = 'e2e-diagnostics-owner@test.com';
  const otherEmployeeEmail = 'e2e-diagnostics-other-employee@test.com';
  const technicianEmail = 'e2e-diagnostics-technician@test.com';
  const supervisorEmail = 'e2e-diagnostics-supervisor@test.com';
  const password = 'CorrectHorseBattery1!';

  let ownerId: string;
  let otherEmployeeId: string;
  let technicianId: string;
  let supervisorId: string;
  let ownerToken: string;
  let otherEmployeeToken: string;
  let technicianToken: string;
  let supervisorToken: string;
  let conversationId: string;

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
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
    await app.init();

    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash(password, 10);

    const [owner, otherEmployee, technician, supervisor] = await Promise.all([
      prisma.user.create({
        data: {
          email: ownerEmail,
          passwordHash,
          displayName: 'E2E Diagnostics Owner',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: otherEmployeeEmail,
          passwordHash,
          displayName: 'E2E Diagnostics Other Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: technicianEmail,
          passwordHash,
          displayName: 'E2E Diagnostics Technician',
          role: Role.TECHNICIAN,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: supervisorEmail,
          passwordHash,
          displayName: 'E2E Diagnostics Supervisor',
          role: Role.SUPERVISOR,
          isActive: true,
        },
      }),
    ]);
    ownerId = owner.id;
    otherEmployeeId = otherEmployee.id;
    technicianId = technician.id;
    supervisorId = supervisor.id;

    [ownerToken, otherEmployeeToken, technicianToken, supervisorToken] =
      await Promise.all([
        loginAs(ownerEmail),
        loginAs(otherEmployeeEmail),
        loginAs(technicianEmail),
        loginAs(supervisorEmail),
      ]);
  });

  afterAll(async () => {
    await prisma.aiFeedback.deleteMany({
      where: { technicianId: { in: [technicianId].filter(Boolean) } },
    });
    await prisma.aiConversation.deleteMany({
      where: { userId: { in: [ownerId].filter(Boolean) } },
    });
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: {
            in: [
              ownerEmail,
              otherEmployeeEmail,
              technicianEmail,
              supervisorEmail,
            ],
          },
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [ownerId, otherEmployeeId, technicianId, supervisorId].filter(
            Boolean,
          ),
        },
      },
    });
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });

  // Timeout raised: exercises the real Anthropic API call (Agent
  // Diagnostic) — slower than Jest's 5s default, same as other e2e files
  // that trigger a real AI call.
  it('creates an AI conversation when diagnosing a ticket description (POST /tickets/ai-diagnose)', async () => {
    const res = await request(app.getHttpServer())
      .post('/tickets/ai-diagnose')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        description:
          "Mon ordinateur n'arrive plus à se connecter au wifi depuis ce matin.",
      })
      .expect(201);

    expect(res.body.conversationId).toEqual(expect.any(String));
    conversationId = res.body.conversationId;
  }, 30000);

  describe('GET /diagnostics/:conversationId', () => {
    it('returns the conversation history (user then agent message) to its owner', async () => {
      const res = await request(app.getHttpServer())
        .get(`/diagnostics/${conversationId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(res.body.id).toBe(conversationId);
      const roles = res.body.messages.map((m: any) => m.role);
      expect(roles).toEqual(['USER', 'AGENT']);
    });

    it('forbids a non-owner employee from reading the conversation', async () => {
      await request(app.getHttpServer())
        .get(`/diagnostics/${conversationId}`)
        .set('Authorization', `Bearer ${otherEmployeeToken}`)
        .expect(403);
    });

    it('returns 404 for an unknown conversation id', async () => {
      await request(app.getHttpServer())
        .get('/diagnostics/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('POST /diagnostics/:conversationId/feedback', () => {
    it('rejects an employee (Technicien only, docs/11 §5)', async () => {
      await request(app.getHttpServer())
        .post(`/diagnostics/${conversationId}/feedback`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ wasHelpful: true })
        .expect(403);
    });

    it('lets a technician record whether the diagnosis was helpful', async () => {
      const res = await request(app.getHttpServer())
        .post(`/diagnostics/${conversationId}/feedback`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ wasHelpful: true, comment: 'Diagnostic pertinent' })
        .expect(201);

      expect(res.body.wasHelpful).toBe(true);
      expect(res.body.comment).toBe('Diagnostic pertinent');
    });
  });

  describe('GET /ai/conversations/:id/cost', () => {
    it('rejects a non-supervisor/admin', async () => {
      await request(app.getHttpServer())
        .get(`/ai/conversations/${conversationId}/cost`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });

    it('returns the aggregated cost for a supervisor', async () => {
      const res = await request(app.getHttpServer())
        .get(`/ai/conversations/${conversationId}/cost`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      expect(res.body.conversationId).toBe(conversationId);
      expect(res.body.callCount).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.totalTokenCost).toBe('number');
    });

    it('returns 404 for an unknown conversation id', async () => {
      await request(app.getHttpServer())
        .get('/ai/conversations/00000000-0000-0000-0000-000000000000/cost')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(404);
    });
  });
});
