import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from '../support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { Role, TicketStatus } from '../../generated/prisma/client';

// ⚠️ REAL ANTHROPIC API — COSTS REAL CREDITS ⚠️
//
// Unlike every other *.e2e-spec.ts file in this project, this suite does
// NOT mock `@anthropic-ai/sdk` (see test/support/anthropic-mock.ts and the
// root README "Tests" section for why every other test does). It is a
// small, deliberate smoke test confirming the real Anthropic API is
// reachable and that AiService's tool-use schemas still round-trip
// correctly against the real model — something the mocked suite can't
// verify by construction.
//
// This file is EXCLUDED from `npm test` and `npm run test:e2e` (see the
// `testPathIgnorePatterns` in test/jest-e2e.json) and from CI. Run it only
// explicitly, with a real ANTHROPIC_API_KEY configured in backend/.env:
//
//   npm run test:integration:live
//
// Keep this file to a handful of tests — one per representative agent is
// enough; exhaustive scenario coverage (high/low confidence, ambiguous
// category, error handling, ...) belongs in the mocked unit tests
// (src/ai/ai.service.spec.ts), not here.
describe('AI real-API smoke tests (live, @real-api)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const employeeEmail = 'e2e-live-employee@test.com';
  const technicianEmail = 'e2e-live-technician@test.com';
  const password = 'CorrectHorseBattery1!';

  let employeeId: string;
  let technicianId: string;
  let employeeToken: string;
  let technicianToken: string;
  let categoryId: string;
  let priorityId: string;
  let assistTicketId: string;
  const createdTicketIds: string[] = [];

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

    const [employee, technician, category, priority] = await Promise.all([
      prisma.user.create({
        data: {
          email: employeeEmail,
          passwordHash,
          displayName: 'E2E Live Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: technicianEmail,
          passwordHash,
          displayName: 'E2E Live Technician',
          role: Role.TECHNICIAN,
          isActive: true,
        },
      }),
      prisma.ticketCategory.create({ data: { name: 'E2E Live Réseau' } }),
      prisma.priority.create({
        data: { name: 'E2E Live Moyenne', level: 2 },
      }),
    ]);
    employeeId = employee.id;
    technicianId = technician.id;
    categoryId = category.id;
    priorityId = priority.id;

    const assistTicket = await prisma.ticket.create({
      data: {
        reference: `TCK-E2E-LIVE-${Date.now()}`,
        employeeId,
        technicianId,
        categoryId,
        priorityId,
        title: 'Imprimante réseau bloquée',
        summary: "Les travaux d'impression ne sortent plus depuis ce matin.",
        status: TicketStatus.IN_PROGRESS,
      },
    });
    assistTicketId = assistTicket.id;
    createdTicketIds.push(assistTicketId);

    [employeeToken, technicianToken] = await Promise.all([
      loginAs(employeeEmail),
      loginAs(technicianEmail),
    ]);
  });

  afterAll(async () => {
    // AiMessage cascades on AiConversation delete (onDelete: Cascade,
    // prisma/schema.prisma) — no separate cleanup needed for it.
    await prisma.aiConversation.deleteMany({
      where: { userId: { in: [employeeId, technicianId] } },
    });
    await prisma.ticket.deleteMany({ where: { id: { in: createdTicketIds } } });
    await prisma.ticketCategory.deleteMany({ where: { id: categoryId } });
    await prisma.priority.deleteMany({ where: { id: priorityId } });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [employeeEmail, technicianEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [employeeEmail, technicianEmail] } },
    });
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });

  // docs/09-architecture-agents-ia.md §3.1 (Agent Diagnostic).
  it('POST /tickets/ai-diagnose reaches the real API and returns a structured suggestion', async () => {
    const res = await apiRequest(app)
      .post('/tickets/ai-diagnose')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        description:
          "Mon ordinateur n'arrive plus à se connecter au wifi depuis ce matin.",
      })
      .expect(201);

    expect(res.body.conversationId).toEqual(expect.any(String));
    expect(typeof res.body.title).toBe('string');
    expect(res.body.title.length).toBeGreaterThan(0);
  }, 30000);

  // docs/09-architecture-agents-ia.md §3.2 (Agent Help Desk).
  it('POST /diagnostics reaches the real API and eventually returns a diagnosis', async () => {
    let res = await apiRequest(app)
      .post('/diagnostics')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        message:
          "L'imprimante réseau du 3e étage ne répond plus depuis ce matin.",
      })
      .expect(201);

    const conversationId: string = res.body.conversationId;
    let turns = 0;
    while (res.body.status === 'NEEDS_INFO' && turns < 5) {
      res = await apiRequest(app)
        .post('/diagnostics')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          message: 'Le problème persiste après redémarrage du poste.',
          conversationId,
        })
        .expect(201);
      turns++;
    }

    expect(res.body.status).toBe('DIAGNOSED');
    expect(typeof res.body.diagnosis.causeProbable).toBe('string');
    expect(res.body.diagnosis.causeProbable.length).toBeGreaterThan(0);
  }, 60000);

  // docs/09-architecture-agents-ia.md §3.3 (Agent Technicien).
  it('POST /tickets/:id/assist reaches the real API and returns an explanation', async () => {
    const res = await apiRequest(app)
      .post(`/tickets/${assistTicketId}/assist`)
      .set('Authorization', `Bearer ${technicianToken}`)
      .send({ question: "Comment relancer le spouleur d'impression ?" })
      .expect(201);

    expect(typeof res.body.explanation).toBe('string');
    expect(res.body.explanation.length).toBeGreaterThan(0);
    expect(res.body.conversationId).toEqual(expect.any(String));
  }, 30000);
});
