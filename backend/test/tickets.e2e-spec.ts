import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role, TicketStatus } from '../generated/prisma/client';

// Critical-path e2e coverage for the ticket lifecycle and RM-04 scoping
// (docs/06-cas-utilisation.md): exercised through real HTTP requests so the
// controller wiring (guards, DTO validation) is verified, not just the
// service logic already covered by tickets.service.spec.ts.
describe('Tickets (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const employeeEmail = 'e2e-tickets-employee@test.com';
  const assignedTechEmail = 'e2e-tickets-tech-assigned@test.com';
  const otherTechEmail = 'e2e-tickets-tech-other@test.com';
  const supervisorEmail = 'e2e-tickets-supervisor@test.com';
  const password = 'CorrectHorseBattery1!';

  let employeeId: string;
  let assignedTechId: string;
  let categoryId: string;
  let priorityId: string;
  let urgentPriorityId: string;
  let teamId: string;

  let employeeToken: string;
  let assignedTechToken: string;
  let otherTechToken: string;
  let supervisorToken: string;

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

    const [employee, assignedTech, otherTech, , category, priority] =
      await Promise.all([
        prisma.user.create({
          data: {
            email: employeeEmail,
            passwordHash,
            displayName: 'E2E Employee',
            role: Role.EMPLOYEE,
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            email: assignedTechEmail,
            passwordHash,
            displayName: 'E2E Assigned Technician',
            role: Role.TECHNICIAN,
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            email: otherTechEmail,
            passwordHash,
            displayName: 'E2E Other Technician',
            role: Role.TECHNICIAN,
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            email: supervisorEmail,
            passwordHash,
            displayName: 'E2E Supervisor',
            role: Role.SUPERVISOR,
            isActive: true,
          },
        }),
        prisma.ticketCategory.create({
          data: { name: 'E2E Test Category' },
        }),
        prisma.priority.create({
          data: { name: 'E2E Test Priority', level: 999 },
        }),
      ]);

    employeeId = employee.id;
    assignedTechId = assignedTech.id;
    categoryId = category.id;
    priorityId = priority.id;

    const urgentPriority = await prisma.priority.create({
      data: { name: 'E2E Urgent Priority', level: 996 },
    });
    urgentPriorityId = urgentPriority.id;
    await prisma.slaPolicy.create({
      data: { priorityId: urgentPriorityId, resolutionHours: 4 },
    });

    // Scopes the auto-assignment fallback (RM-04's "generalist" path, no
    // team match) to just this fixture's two technicians. Without a team
    // tied to categoryId, that fallback legitimately scans every active
    // TECHNICIAN in the real Postgres instance — and e2e spec files run in
    // parallel Jest workers against that same shared database, so it could
    // otherwise pick up a technician fixture from a different, concurrently
    // running spec file.
    teamId = (
      await prisma.team.create({
        data: { name: 'E2E Test Team', categoryId },
      })
    ).id;
    await prisma.user.updateMany({
      where: { id: { in: [assignedTechId, otherTech.id] } },
      data: { teamId },
    });

    [employeeToken, assignedTechToken, otherTechToken, supervisorToken] =
      await Promise.all([
        loginAs(employeeEmail),
        loginAs(assignedTechEmail),
        loginAs(otherTechEmail),
        loginAs(supervisorEmail),
      ]);
  });

  afterAll(async () => {
    const userEmails = [
      employeeEmail,
      assignedTechEmail,
      otherTechEmail,
      supervisorEmail,
    ];
    // docs/09-architecture-agents-ia.md §3.3 : POST /tickets/:id/assist
    // persiste une AiConversation par appel (user_id est RESTRICT) — à
    // supprimer avant les utilisateurs, comme pour toute AiConversation de
    // test (voir la même leçon dans diagnostics.e2e-spec.ts).
    await prisma.aiConversation.deleteMany({
      where: { user: { email: { in: userEmails } } },
    });
    await prisma.ticketStatusHistory.deleteMany({
      where: { ticket: { employeeId } },
    });
    await prisma.ticket.deleteMany({ where: { employeeId } });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: userEmails } } },
    });
    await prisma.user.updateMany({
      where: { email: { in: userEmails } },
      data: { teamId: null },
    });
    await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.ticketCategory.delete({ where: { id: categoryId } });
    await prisma.slaPolicy.deleteMany({
      where: { priorityId: urgentPriorityId },
    });
    await prisma.priority.delete({ where: { id: priorityId } });
    await prisma.priority.delete({ where: { id: urgentPriorityId } });
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

  let ticketId: string;

  it('creates a ticket assigned to the technician (POST /tickets)', async () => {
    const res = await apiRequest(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        categoryId,
        priorityId,
        technicianId: assignedTechId,
        title: 'E2E: mon écran ne s’allume plus',
      })
      .expect(201);

    expect(res.body.status).toBe(TicketStatus.NEW);
    expect(res.body.employee.id).toBe(employeeId);
    expect(res.body.technician.id).toBe(assignedTechId);
    ticketId = res.body.id;
  });

  // docs/02-brd.md BR-07: correcting the priority must also correct the SLA
  // deadline (recomputed from the ticket's original creation time), not
  // silently keep the deadline the wrong priority produced.
  it('recomputes the SLA deadline from createdAt when the priority is corrected', async () => {
    const created = await apiRequest(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        categoryId,
        priorityId, // "E2E Test Priority" has no SLA policy: slaDueAt starts null
        technicianId: assignedTechId,
        title: 'E2E: ticket mal priorisé, à corriger',
      })
      .expect(201);

    expect(created.body.slaDueAt).toBeNull();
    const createdAt = new Date(created.body.createdAt).getTime();

    const res = await apiRequest(app)
      .patch(`/tickets/${created.body.id}`)
      .set('Authorization', `Bearer ${assignedTechToken}`)
      .send({ priorityId: urgentPriorityId })
      .expect(200);

    expect(res.body.priority.id).toBe(urgentPriorityId);
    expect(res.body.slaDueAt).not.toBeNull();
    expect(new Date(res.body.slaDueAt).getTime()).toBe(
      createdAt + 4 * 60 * 60 * 1000,
    );

    await prisma.ticket.delete({ where: { id: created.body.id } });
  });

  it('ignores a spoofed employeeId in the request body and always uses the authenticated requester (IDOR fix)', async () => {
    const res = await apiRequest(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        employeeId: assignedTechId, // attempt to create the ticket in someone else's name
        categoryId,
        priorityId,
        title: 'E2E: tentative de spoofing employeeId',
      })
      .expect(201);

    expect(res.body.employee.id).toBe(employeeId);
    expect(res.body.employee.id).not.toBe(assignedTechId);

    await prisma.ticket.delete({ where: { id: res.body.id } });
  });

  it('rejects ticket creation from a non-EMPLOYEE role', async () => {
    await apiRequest(app)
      .post('/tickets')
      .set('Authorization', `Bearer ${assignedTechToken}`)
      .send({ employeeId, categoryId, priorityId, title: 'Should be rejected' })
      .expect(403);
  });

  it('scopes GET /tickets to only the requester’s own tickets for an EMPLOYEE', async () => {
    const res = await apiRequest(app)
      .get('/tickets')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(
      res.body.every((ticket: any) => ticket.employee.id === employeeId),
    ).toBe(true);
    expect(res.body.some((ticket: any) => ticket.id === ticketId)).toBe(true);
  });

  it('scopes GET /tickets to only assigned tickets for a TECHNICIAN', async () => {
    const res = await apiRequest(app)
      .get('/tickets')
      .set('Authorization', `Bearer ${otherTechToken}`)
      .expect(200);

    expect(
      res.body.every((ticket: any) => ticket.technician?.id === assignedTechId),
    ).toBe(true);
    expect(res.body.some((ticket: any) => ticket.id === ticketId)).toBe(false);
  });

  it('forbids GET /tickets/:id for a technician who is not assigned to it', async () => {
    await apiRequest(app)
      .get(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${otherTechToken}`)
      .expect(403);
  });

  it('allows GET /tickets/:id for the assigned technician', async () => {
    await apiRequest(app)
      .get(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${assignedTechToken}`)
      .expect(200);
  });

  it('forbids PATCH /tickets/:id for a technician who is not assigned to it', async () => {
    await apiRequest(app)
      .patch(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${otherTechToken}`)
      .send({ status: TicketStatus.IN_PROGRESS })
      .expect(403);
  });

  it('lets the assigned technician move the ticket to IN_PROGRESS', async () => {
    const res = await apiRequest(app)
      .patch(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${assignedTechToken}`)
      .send({ status: TicketStatus.IN_PROGRESS })
      .expect(200);

    expect(res.body.status).toBe(TicketStatus.IN_PROGRESS);
  });

  it('rejects rating a ticket that is not yet resolved', async () => {
    await apiRequest(app)
      .post(`/tickets/${ticketId}/rate`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ rating: 5 })
      .expect(400);
  });

  it('rejects resolving a ticket without a resolution note (UC-013)', async () => {
    const res = await apiRequest(app)
      .patch(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${assignedTechToken}`)
      .send({ status: TicketStatus.RESOLVED })
      .expect(400);

    expect(res.body.message).toContain('note de résolution');
  });

  // Timeout raised: resolving a ticket now triggers a real call to the
  // Anthropic API (docs/10-architecture-rag.md §11, Agent Documentation
  // proposes a knowledge article) — slower than Jest's 5s default.
  it('lets the assigned technician resolve the ticket with a resolution note (UC-013)', async () => {
    const res = await apiRequest(app)
      .patch(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${assignedTechToken}`)
      .send({
        status: TicketStatus.RESOLVED,
        resolutionNote: "Redémarrage du poste — le pilote s'était mal chargé.",
      })
      .expect(200);

    expect(res.body.status).toBe(TicketStatus.RESOLVED);
    expect(res.body.resolutionNote).toBe(
      "Redémarrage du poste — le pilote s'était mal chargé.",
    );
  }, 30000);

  it('rejects a rating from someone other than the owning employee', async () => {
    await apiRequest(app)
      .post(`/tickets/${ticketId}/rate`)
      .set('Authorization', `Bearer ${assignedTechToken}`)
      .send({ rating: 5 })
      .expect(403);
  });

  it('lets the owning employee rate the resolved ticket', async () => {
    const res = await apiRequest(app)
      .post(`/tickets/${ticketId}/rate`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ rating: 5, comment: 'Résolu rapidement, merci' })
      .expect(201);

    expect(res.body.rating).toBe(5);
  });

  // docs/09-architecture-agents-ia.md §3.3 (Agent Technicien).
  describe('POST /tickets/:id/assist (Agent Technicien)', () => {
    it('rejects an employee (réservé au rôle TECHNICIAN)', async () => {
      await apiRequest(app)
        .post(`/tickets/${ticketId}/assist`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ question: "Comment relancer le spouleur d'impression ?" })
        .expect(403);
    });

    it('rejects a technician who is not assigned to the ticket (RM-04)', async () => {
      await apiRequest(app)
        .post(`/tickets/${ticketId}/assist`)
        .set('Authorization', `Bearer ${otherTechToken}`)
        .send({ question: "Comment relancer le spouleur d'impression ?" })
        .expect(403);
    });

    // Timeout raised: exercises the real Anthropic API call (Agent
    // Technicien) — slower than Jest's 5s default, same as other e2e
    // files that trigger a real AI call.
    it('gives the assigned technician an explanation, never executing anything', async () => {
      const res = await apiRequest(app)
        .post(`/tickets/${ticketId}/assist`)
        .set('Authorization', `Bearer ${assignedTechToken}`)
        .send({ question: "Comment relancer le spouleur d'impression ?" })
        .expect(201);

      expect(typeof res.body.explanation).toBe('string');
      expect(res.body.explanation.length).toBeGreaterThan(0);
      expect(res.body.conversationId).toEqual(expect.any(String));

      // docs/09 §2 point 6 : chaque appel doit être journalisé — vérifie que
      // le technicien peut relire sa propre conversation via l'endpoint déjà
      // existant (DiagnosticsService.getConversation n'est pas restreint par
      // rôle, seulement par propriété de la conversation).
      const conversation = await apiRequest(app)
        .get(`/diagnostics/${res.body.conversationId}`)
        .set('Authorization', `Bearer ${assignedTechToken}`)
        .expect(200);

      const roles = conversation.body.messages.map((m: any) => m.role);
      expect(roles).toEqual(['USER', 'AGENT']);
    }, 30000);
  });

  // docs/02-brd.md BR-07, §7 "Critères de succès".
  describe('AI-suggested category/priority (BR-07)', () => {
    it('persists the AI-suggested category/priority separately from the final ones and includes them in the ticket response', async () => {
      const res = await apiRequest(app)
        .post('/tickets')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          categoryId,
          priorityId: urgentPriorityId, // final priority differs from the AI suggestion below
          title: 'E2E BR-07 : priorité corrigée manuellement',
          aiSuggestedCategoryId: categoryId,
          aiSuggestedPriorityId: priorityId,
        })
        .expect(201);

      expect(res.body.aiSuggestedCategoryId).toBe(categoryId);
      expect(res.body.aiSuggestedPriorityId).toBe(priorityId);
      expect(res.body.priorityId).toBe(urgentPriorityId);

      await prisma.ticket.delete({ where: { id: res.body.id } });
    });

    it('leaves the AI-suggested fields null for a purely manual ticket', async () => {
      const res = await apiRequest(app)
        .post('/tickets')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          categoryId,
          priorityId,
          title: 'E2E BR-07 : ticket créé sans passer par l’IA',
        })
        .expect(201);

      expect(res.body.aiSuggestedCategoryId).toBeNull();
      expect(res.body.aiSuggestedPriorityId).toBeNull();

      await prisma.ticket.delete({ where: { id: res.body.id } });
    });

    it('surfaces a non-null aiCorrectionRate on the supervisor dashboard once an AI-assisted ticket exists', async () => {
      const created = await apiRequest(app)
        .post('/tickets')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          categoryId,
          priorityId: urgentPriorityId,
          title:
            'E2E BR-07 : alimente le taux de correction du tableau de bord',
          aiSuggestedCategoryId: categoryId,
          aiSuggestedPriorityId: priorityId,
        })
        .expect(201);

      const stats = await apiRequest(app)
        .get('/dashboard/stats')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      expect(stats.body.aiCorrectionRate).not.toBeNull();
      expect(typeof stats.body.aiCorrectionRate).toBe('number');

      await prisma.ticket.delete({ where: { id: created.body.id } });
    });

    it('rejects a non-supervisor/admin from reading the dashboard', async () => {
      await apiRequest(app)
        .get('/dashboard/stats')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });
  });
});
