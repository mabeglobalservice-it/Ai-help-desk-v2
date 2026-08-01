import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role, TicketStatus } from '../generated/prisma/client';

// docs/05-user-stories.md US-26, docs/10-architecture-rag.md section 13
// (niveau 3 "tickets résolus") — full-text search over resolved tickets.
// Exercised against a real Postgres since the query itself (tsvector/
// ts_rank/ts_headline) is what's under test, not just controller wiring.
describe('Knowledge (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const employeeEmail = 'e2e-knowledge-employee@test.com';
  const technicianEmail = 'e2e-knowledge-technician@test.com';
  const supervisorEmail = 'e2e-knowledge-supervisor@test.com';
  const password = 'CorrectHorseBattery1!';

  let categoryId: string;
  let priorityId: string;
  let printerTicketId: string;
  let screenTicketId: string;
  let openTicketId: string;
  let toApproveTicketId: string;
  let toRejectTicketId: string;

  let employeeToken: string;
  let technicianToken: string;
  let supervisorToken: string;

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

    const [employee, technician, , category, priority] = await Promise.all([
      prisma.user.create({
        data: {
          email: employeeEmail,
          passwordHash,
          displayName: 'E2E Knowledge Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: technicianEmail,
          passwordHash,
          displayName: 'E2E Knowledge Technician',
          role: Role.TECHNICIAN,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: supervisorEmail,
          passwordHash,
          displayName: 'E2E Knowledge Supervisor',
          role: Role.SUPERVISOR,
          isActive: true,
        },
      }),
      prisma.ticketCategory.create({
        data: { name: 'E2E Knowledge Category' },
      }),
      prisma.priority.create({
        data: { name: 'E2E Knowledge Priority', level: 998 },
      }),
    ]);

    categoryId = category.id;
    priorityId = priority.id;

    const [printerTicket, screenTicket, openTicket] = await Promise.all([
      prisma.ticket.create({
        data: {
          reference: 'TCK-E2E-KNOWLEDGE-0001',
          employeeId: employee.id,
          categoryId,
          priorityId,
          title: 'Imprimante réseau bloquée au 3e étage',
          summary:
            "Le redémarrage du service de spouleur d'impression sur le serveur a résolu le blocage des travaux en file d'attente.",
          status: TicketStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      }),
      prisma.ticket.create({
        data: {
          reference: 'TCK-E2E-KNOWLEDGE-0002',
          employeeId: employee.id,
          categoryId,
          priorityId,
          title: 'Écran bleu au démarrage',
          summary: 'La mise à jour du pilote graphique a corrigé le problème.',
          status: TicketStatus.RESOLVED,
          resolvedAt: new Date(),
        },
      }),
      prisma.ticket.create({
        data: {
          reference: 'TCK-E2E-KNOWLEDGE-0003',
          employeeId: employee.id,
          categoryId,
          priorityId,
          title: 'Imprimante ne répond plus',
          summary:
            'Ticket encore ouvert, pas de solution trouvée pour le moment.',
          status: TicketStatus.NEW,
        },
      }),
    ]);

    [toApproveTicketId, toRejectTicketId] = (
      await Promise.all([
        prisma.ticket.create({
          data: {
            reference: 'TCK-E2E-KNOWLEDGE-ARTICLE-0001',
            employeeId: employee.id,
            technicianId: technician.id,
            categoryId,
            priorityId,
            title: 'E2E: ticket à approuver pour la base de connaissances',
            summary: 'Problème à résoudre pour tester la proposition.',
            status: TicketStatus.IN_PROGRESS,
          },
        }),
        prisma.ticket.create({
          data: {
            reference: 'TCK-E2E-KNOWLEDGE-ARTICLE-0002',
            employeeId: employee.id,
            technicianId: technician.id,
            categoryId,
            priorityId,
            title: 'E2E: ticket à rejeter pour la base de connaissances',
            summary: 'Problème à résoudre pour tester le rejet.',
            status: TicketStatus.IN_PROGRESS,
          },
        }),
      ])
    ).map((t) => t.id);

    printerTicketId = printerTicket.id;
    screenTicketId = screenTicket.id;
    openTicketId = openTicket.id;

    [employeeToken, technicianToken, supervisorToken] = await Promise.all([
      loginAs(employeeEmail),
      loginAs(technicianEmail),
      loginAs(supervisorEmail),
    ]);
  });

  afterAll(async () => {
    await prisma.knowledgeArticle.deleteMany({
      where: {
        ticket: {
          OR: [
            { id: { in: [printerTicketId, screenTicketId, openTicketId] } },
            { reference: { startsWith: 'TCK-E2E-KNOWLEDGE-ARTICLE' } },
          ],
        },
      },
    });
    await prisma.ticket.deleteMany({
      where: {
        OR: [
          { id: { in: [printerTicketId, screenTicketId, openTicketId] } },
          { reference: { startsWith: 'TCK-E2E-KNOWLEDGE-ARTICLE' } },
        ],
      },
    });
    await prisma.ticketCategory.delete({ where: { id: categoryId } });
    await prisma.priority.delete({ where: { id: priorityId } });
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: { in: [employeeEmail, technicianEmail, supervisorEmail] },
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: [employeeEmail, technicianEmail, supervisorEmail] },
      },
    });
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

  it('rejects the search for an EMPLOYEE (US-26 restricts this to TECHNICIAN/SUPERVISOR/ADMIN)', async () => {
    await request(app.getHttpServer())
      .get('/knowledge/search')
      .query({ q: 'imprimante' })
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(403);
  });

  it('rejects an unauthenticated search', async () => {
    await request(app.getHttpServer())
      .get('/knowledge/search')
      .query({ q: 'imprimante' })
      .expect(401);
  });

  it('rejects a query shorter than 2 characters', async () => {
    await request(app.getHttpServer())
      .get('/knowledge/search')
      .query({ q: 'a' })
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(400);
  });

  it('finds the matching resolved ticket and excludes unrelated or unresolved ones', async () => {
    const res = await request(app.getHttpServer())
      .get('/knowledge/search')
      .query({ q: 'imprimante bloquée' })
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    const ids = res.body.map((row: any) => row.id);
    expect(ids).toContain(printerTicketId);
    expect(ids).not.toContain(screenTicketId);
    expect(ids).not.toContain(openTicketId); // still NEW, never resolved

    const match = res.body.find((row: any) => row.id === printerTicketId);
    expect(match.reference).toBe('TCK-E2E-KNOWLEDGE-0001');
    expect(match.snippet).toContain('**');
  });

  it('finds a different ticket for an unrelated query', async () => {
    const res = await request(app.getHttpServer())
      .get('/knowledge/search')
      .query({ q: 'écran pilote graphique' })
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    const ids = res.body.map((row: any) => row.id);
    expect(ids).toContain(screenTicketId);
    expect(ids).not.toContain(printerTicketId);
  });

  it('returns an empty array for a query matching nothing', async () => {
    const res = await request(app.getHttpServer())
      .get('/knowledge/search')
      .query({ q: 'zzznomatchxyz' })
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  // docs/10-architecture-rag.md §11 "Apprentissage continu", docs/11-
  // documentation-api.md §7: la résolution d'un ticket propose un article,
  // jamais indexé (recherchable) tant qu'il n'a pas été approuvé.
  describe('Agent Documentation (propose/approve knowledge articles)', () => {
    function longestWord(text: string): string {
      return text
        .split(/\s+/)
        .reduce(
          (longest, word) => (word.length > longest.length ? word : longest),
          '',
        );
    }

    it('rejects listing pending articles for a plain TECHNICIAN', async () => {
      await request(app.getHttpServer())
        .get('/knowledge/articles/pending')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);
    });

    // Timeout raised: this test resolves a ticket, which triggers a real
    // call to the Anthropic API (Agent Documentation summary generation) —
    // slower than Jest's 5s default.
    it('proposes an article on resolution, keeps it unsearchable until approved, then indexes it', async () => {
      await request(app.getHttpServer())
        .patch(`/tickets/${toApproveTicketId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ status: TicketStatus.RESOLVED, resolutionNote: 'Résolu.' })
        .expect(200);

      const pending = await request(app.getHttpServer())
        .get('/knowledge/articles/pending')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const proposed = pending.body.find(
        (a: any) => a.ticket.id === toApproveTicketId,
      );
      expect(proposed).toBeDefined();
      expect(proposed.status).toBe('PROPOSED');

      const keyword = longestWord(proposed.title || proposed.content);

      const beforeApproval = await request(app.getHttpServer())
        .get('/knowledge/search')
        .query({ q: keyword })
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        beforeApproval.body.some(
          (row: any) => row.sourceType === 'ARTICLE' && row.id === proposed.id,
        ),
      ).toBe(false);

      const approved = await request(app.getHttpServer())
        .patch(`/knowledge/articles/${proposed.id}/approve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');

      const afterApproval = await request(app.getHttpServer())
        .get('/knowledge/search')
        .query({ q: keyword })
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        afterApproval.body.some(
          (row: any) => row.sourceType === 'ARTICLE' && row.id === proposed.id,
        ),
      ).toBe(true);

      await request(app.getHttpServer())
        .patch(`/knowledge/articles/${proposed.id}/approve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(400);
    }, 30000);

    // Timeout raised: same reason as above (real Anthropic API call).
    it('rejects a proposed article, which never becomes searchable', async () => {
      await request(app.getHttpServer())
        .patch(`/tickets/${toRejectTicketId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ status: TicketStatus.RESOLVED, resolutionNote: 'Résolu.' })
        .expect(200);

      const pending = await request(app.getHttpServer())
        .get('/knowledge/articles/pending')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const proposed = pending.body.find(
        (a: any) => a.ticket.id === toRejectTicketId,
      );
      expect(proposed).toBeDefined();

      const rejected = await request(app.getHttpServer())
        .patch(`/knowledge/articles/${proposed.id}/approve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ decision: 'REJECTED' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');

      const keyword = longestWord(proposed.title || proposed.content);
      const afterRejection = await request(app.getHttpServer())
        .get('/knowledge/search')
        .query({ q: keyword })
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        afterRejection.body.some(
          (row: any) => row.sourceType === 'ARTICLE' && row.id === proposed.id,
        ),
      ).toBe(false);
    }, 30000);
  });
});
