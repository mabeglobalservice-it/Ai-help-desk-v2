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
  let categoryId: string;
  let priorityId: string;
  const createdTicketIds: string[] = [];

  async function loginAs(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken;
  }

  // docs/06-cas-utilisation.md UC-001 étapes 1-6 : l'Agent Help Desk pose au
  // plus une question de clarification à la fois, jusqu'à un maximum de 3
  // tours (MAX_CLARIFYING_TURNS) au-delà duquel un diagnostic est forcé —
  // ce repli borne la boucle pour un test déterministe malgré un appel réel
  // à l'API Anthropic dont le nombre exact de questions n'est pas garanti.
  async function converseUntilDiagnosed(
    token: string,
    firstMessage: string,
  ): Promise<{ conversationId: string; body: Record<string, any> }> {
    let res = await request(app.getHttpServer())
      .post('/diagnostics')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: firstMessage })
      .expect(201);

    const startedConversationId: string = res.body.conversationId;
    let turns = 0;
    while (res.body.status === 'NEEDS_INFO' && turns < 5) {
      res = await request(app.getHttpServer())
        .post('/diagnostics')
        .set('Authorization', `Bearer ${token}`)
        .send({
          message: 'Windows 11, le problème persiste après redémarrage',
          conversationId: startedConversationId,
        })
        .expect(201);
      turns++;
    }
    return { conversationId: startedConversationId, body: res.body };
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

    const [category, priority] = await Promise.all([
      prisma.ticketCategory.findFirst(),
      prisma.priority.findFirst(),
    ]);
    categoryId = category!.id;
    priorityId = priority!.id;
  });

  afterAll(async () => {
    await prisma.aiFeedback.deleteMany({
      where: { technicianId: { in: [technicianId].filter(Boolean) } },
    });
    // docs/06 UC-001 étape 7 : quelques tests créent une conversation pour
    // otherEmployeeId (pas seulement ownerId) — il faut couvrir les deux
    // pour ne rien laisser d'orphelin (ai_conversations.user_id est RESTRICT).
    await prisma.aiConversation.deleteMany({
      where: { userId: { in: [ownerId, otherEmployeeId].filter(Boolean) } },
    });
    if (createdTicketIds.length > 0) {
      await prisma.ticket.deleteMany({
        where: { id: { in: createdTicketIds } },
      });
    }
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

  // docs/06-cas-utilisation.md UC-001, docs/09-architecture-agents-ia.md §3.2
  // (Agent Help Desk) : dialogue multi-tour, avant toute création de ticket.
  // POST /diagnostics is rate-limited to 10 req/60s (docs/11 §5) and each
  // call here exercises the real Anthropic API — these tests are kept to a
  // minimum and reuse the same conversation across assertions rather than
  // starting a fresh one each time, to stay comfortably under that budget.
  describe('POST /diagnostics (Agent Help Desk conversationnel)', () => {
    let helpdeskConversationId: string;

    it('starts a new conversation and eventually reaches a diagnosis (cause probable + étapes)', async () => {
      const { conversationId: convId, body } = await converseUntilDiagnosed(
        ownerToken,
        "Mon ordinateur n'arrive plus à se connecter au wifi depuis ce matin.",
      );
      helpdeskConversationId = convId;

      expect(convId).toEqual(expect.any(String));
      expect(body.status).toBe('DIAGNOSED');
      expect(body.diagnosis.causeProbable).toEqual(expect.any(String));
      expect(Array.isArray(body.diagnosis.suggestedSteps)).toBe(true);
      expect(body.diagnosis.suggestedSteps.length).toBeGreaterThan(0);
      expect(typeof body.diagnosis.confidence).toBe('number');
    }, 60000);

    it('forbids continuing a conversation that belongs to another employee', async () => {
      // Reuses the conversation from the previous test: converseDiagnostic
      // never changes AiConversation.status itself (only the /resolve
      // endpoint does), so it is still ONGOING and a single extra call
      // suffices to exercise the ownership check.
      await request(app.getHttpServer())
        .post('/diagnostics')
        .set('Authorization', `Bearer ${otherEmployeeToken}`)
        .send({ message: 'oui', conversationId: helpdeskConversationId })
        .expect(404);
    });

    it('returns 404 when continuing an unknown conversation id', async () => {
      await request(app.getHttpServer())
        .post('/diagnostics')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          message: 'oui',
          conversationId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);
    });
  });

  // docs/06-cas-utilisation.md UC-001 étape 6 (US-02/US-03).
  // resolveConversation is pure Prisma logic (no AI call at all), so these
  // tests seed an ONGOING AiConversation directly via Prisma instead of
  // going through the rate-limited POST /diagnostics — deterministic, and
  // it keeps the whole file well under that endpoint's 10 req/60s budget.
  describe('POST /diagnostics/:conversationId/resolve', () => {
    async function seedOngoingConversation(userId: string): Promise<string> {
      const conversation = await prisma.aiConversation.create({
        data: {
          userId,
          provider: 'CLAUDE',
          model: 'claude-sonnet-5',
        },
      });
      await prisma.aiMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'USER',
          content: "Mon écran externe ne s'allume plus.",
        },
      });
      return conversation.id;
    }

    it('marks the conversation RESOLVED and creates no ticket when the problem is fixed (US-02)', async () => {
      const convId = await seedOngoingConversation(ownerId);

      const resolveRes = await request(app.getHttpServer())
        .post(`/diagnostics/${convId}/resolve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ resolved: true })
        .expect(201);
      expect(resolveRes.body.status).toBe('RESOLVED');

      const stored = await prisma.aiConversation.findUnique({
        where: { id: convId },
      });
      expect(stored?.status).toBe('RESOLVED');
      expect(stored?.ticketId).toBeNull();
    });

    it('rejects resolving a conversation that is already terminated', async () => {
      const convId = await seedOngoingConversation(ownerId);

      await request(app.getHttpServer())
        .post(`/diagnostics/${convId}/resolve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ resolved: true })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/diagnostics/${convId}/resolve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ resolved: true })
        .expect(400);
    });

    it("rejects a non-owner resolving someone else's conversation", async () => {
      const convId = await seedOngoingConversation(ownerId);

      await request(app.getHttpServer())
        .post(`/diagnostics/${convId}/resolve`)
        .set('Authorization', `Bearer ${otherEmployeeToken}`)
        .send({ resolved: true })
        .expect(404);
    });

    // docs/06-cas-utilisation.md UC-001 étape 7, docs/09 §3.2 : le problème
    // persiste -> la conversation reste ONGOING jusqu'à ce que POST /tickets
    // avec conversationId l'escalade (voir TicketsService.create).
    it('leaves the conversation ONGOING when the problem persists, then escalates it once a ticket is created', async () => {
      const convId = await seedOngoingConversation(otherEmployeeId);

      const resolveRes = await request(app.getHttpServer())
        .post(`/diagnostics/${convId}/resolve`)
        .set('Authorization', `Bearer ${otherEmployeeToken}`)
        .send({ resolved: false })
        .expect(201);
      expect(resolveRes.body.status).toBe('PERSISTS');

      const stillOngoing = await prisma.aiConversation.findUnique({
        where: { id: convId },
      });
      expect(stillOngoing?.status).toBe('ONGOING');

      const ticketRes = await request(app.getHttpServer())
        .post('/tickets')
        .set('Authorization', `Bearer ${otherEmployeeToken}`)
        .send({
          categoryId,
          priorityId,
          title: 'Redémarrages intempestifs du poste de travail',
          summary: 'Créé automatiquement depuis le diagnostic conversationnel',
          conversationId: convId,
        })
        .expect(201);
      createdTicketIds.push(ticketRes.body.id);

      const escalated = await prisma.aiConversation.findUnique({
        where: { id: convId },
      });
      expect(escalated?.status).toBe('ESCALATED');
      expect(escalated?.ticketId).toBe(ticketRes.body.id);
    }, 60000);
  });

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
