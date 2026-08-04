import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { KnowledgeService } from '../src/knowledge/knowledge.service';
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
  const otherTechnicianEmail = 'e2e-knowledge-technician-2@test.com';
  const supervisorEmail = 'e2e-knowledge-supervisor@test.com';
  const adminEmail = 'e2e-knowledge-admin@test.com';
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
  let otherTechnicianToken: string;
  let supervisorToken: string;
  let adminToken: string;
  let technicianId: string;
  let otherTechnicianId: string;
  let adminId: string;

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

    const [employee, technician, otherTechnician, , admin, category, priority] =
      await Promise.all([
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
            email: otherTechnicianEmail,
            passwordHash,
            displayName: 'E2E Knowledge Technician 2',
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
        prisma.user.create({
          data: {
            email: adminEmail,
            passwordHash,
            displayName: 'E2E Knowledge Admin',
            role: Role.ADMIN,
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

    technicianId = technician.id;
    otherTechnicianId = otherTechnician.id;
    adminId = admin.id;

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

    // Ces tickets sont créés directement via Prisma (pas via
    // PATCH /tickets/:id), donc le hook d'indexation RAG de TicketsService
    // (docs/10 §13 niveau 3) ne se déclenche pas automatiquement — on
    // reproduit ici ce que ferait KnowledgeService.indexResolvedTicket.
    const knowledgeService = app.get(KnowledgeService);
    await knowledgeService.indexResolvedTicket(printerTicket);
    await knowledgeService.indexResolvedTicket(screenTicket);

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

    [
      employeeToken,
      technicianToken,
      otherTechnicianToken,
      supervisorToken,
      adminToken,
    ] = await Promise.all([
      loginAs(employeeEmail),
      loginAs(technicianEmail),
      loginAs(otherTechnicianEmail),
      loginAs(supervisorEmail),
      loginAs(adminEmail),
    ]);
  });

  afterAll(async () => {
    await prisma.documentChunk.deleteMany({
      where: {
        OR: [
          { ownerId: { in: [technicianId, otherTechnicianId, adminId] } },
          {
            document: {
              uploadedById: { in: [technicianId, otherTechnicianId, adminId] },
            },
          },
        ],
      },
    });
    await prisma.knowledgeDocument.deleteMany({
      where: {
        uploadedById: { in: [technicianId, otherTechnicianId, adminId] },
      },
    });
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
    const allEmails = [
      employeeEmail,
      technicianEmail,
      otherTechnicianEmail,
      supervisorEmail,
      adminEmail,
    ];
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: allEmails } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: allEmails } },
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

  // docs/10-architecture-rag.md §10 : un EMPLOYEE n'a accès qu'au niveau 1
  // (public) — aucun document de ce niveau n'est seedé ici, donc la
  // recherche réussit mais ne renvoie jamais un ticket/article (niveaux 2/3).
  it('allows the search for an EMPLOYEE, restricted to level 1 (doc 10 §10)', async () => {
    const res = await apiRequest(app)
      .get('/knowledge/search')
      .query({ q: 'imprimante bloquée' })
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('rejects an unauthenticated search', async () => {
    await apiRequest(app)
      .get('/knowledge/search')
      .query({ q: 'imprimante' })
      .expect(401);
  });

  it('rejects a query shorter than 2 characters', async () => {
    await apiRequest(app)
      .get('/knowledge/search')
      .query({ q: 'a' })
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(400);
  });

  it('finds the matching resolved ticket and excludes unrelated or unresolved ones', async () => {
    const res = await apiRequest(app)
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
    const res = await apiRequest(app)
      .get('/knowledge/search')
      .query({ q: 'écran pilote graphique' })
      .set('Authorization', `Bearer ${technicianToken}`)
      .expect(200);

    const ids = res.body.map((row: any) => row.id);
    expect(ids).toContain(screenTicketId);
    expect(ids).not.toContain(printerTicketId);
  });

  it('returns an empty array for a query matching nothing', async () => {
    const res = await apiRequest(app)
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
      await apiRequest(app)
        .get('/knowledge/articles/pending')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(403);
    });

    // Timeout raised: this test resolves a ticket, which triggers a real
    // call to the Anthropic API (Agent Documentation summary generation) —
    // slower than Jest's 5s default.
    it('proposes an article on resolution, keeps it unsearchable until approved, then indexes it', async () => {
      await apiRequest(app)
        .patch(`/tickets/${toApproveTicketId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ status: TicketStatus.RESOLVED, resolutionNote: 'Résolu.' })
        .expect(200);

      const pending = await apiRequest(app)
        .get('/knowledge/articles/pending')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const proposed = pending.body.find(
        (a: any) => a.ticket.id === toApproveTicketId,
      );
      expect(proposed).toBeDefined();
      expect(proposed.status).toBe('PROPOSED');

      const keyword = longestWord(proposed.title || proposed.content);

      const beforeApproval = await apiRequest(app)
        .get('/knowledge/search')
        .query({ q: keyword })
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        beforeApproval.body.some(
          (row: any) => row.sourceType === 'ARTICLE' && row.id === proposed.id,
        ),
      ).toBe(false);

      const approved = await apiRequest(app)
        .patch(`/knowledge/articles/${proposed.id}/approve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
      expect(approved.body.status).toBe('APPROVED');

      const afterApproval = await apiRequest(app)
        .get('/knowledge/search')
        .query({ q: keyword })
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        afterApproval.body.some(
          (row: any) => row.sourceType === 'ARTICLE' && row.id === proposed.id,
        ),
      ).toBe(true);

      await apiRequest(app)
        .patch(`/knowledge/articles/${proposed.id}/approve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(400);
    }, 30000);

    // Timeout raised: same reason as above (real Anthropic API call).
    it('rejects a proposed article, which never becomes searchable', async () => {
      await apiRequest(app)
        .patch(`/tickets/${toRejectTicketId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({ status: TicketStatus.RESOLVED, resolutionNote: 'Résolu.' })
        .expect(200);

      const pending = await apiRequest(app)
        .get('/knowledge/articles/pending')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const proposed = pending.body.find(
        (a: any) => a.ticket.id === toRejectTicketId,
      );
      expect(proposed).toBeDefined();

      const rejected = await apiRequest(app)
        .patch(`/knowledge/articles/${proposed.id}/approve`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ decision: 'REJECTED' })
        .expect(200);
      expect(rejected.body.status).toBe('REJECTED');

      const keyword = longestWord(proposed.title || proposed.content);
      const afterRejection = await apiRequest(app)
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

  // docs/11-documentation-api.md §7, docs/10-architecture-rag.md §13
  // ("RAG multi-niveaux") : ingestion de documents et filtrage par niveau.
  describe('POST/GET/DELETE /knowledge/documents (RAG multi-niveaux)', () => {
    it('rejects a SUPERVISOR (doc 11 §7 only names Technicien/Admin)', async () => {
      await apiRequest(app)
        .post('/knowledge/documents')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ title: 'x', content: 'Contenu suffisamment long' })
        .expect(403);
    });

    it('lets a TECHNICIAN upload a personal note, always indexed at level 5', async () => {
      const res = await apiRequest(app)
        .post('/knowledge/documents')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({
          title: 'Astuce imprimante réseau personnelle',
          content:
            'Astuce imprimante réseau personnelle non documentée ailleurs.',
          knowledgeLevel: 1,
        })
        .expect(201);

      expect(res.body.knowledgeLevel).toBe(5);
      expect(res.body.ownerId).toBeDefined();

      const found = await apiRequest(app)
        .get('/knowledge/search')
        .query({ q: 'astuce imprimante personnelle' })
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(
        found.body.some(
          (row: any) => row.sourceType === 'DOCUMENT' && row.id === res.body.id,
        ),
      ).toBe(true);

      // Un autre technicien n'a pas accès à cette note personnelle.
      const notFound = await apiRequest(app)
        .get('/knowledge/search')
        .query({ q: 'astuce imprimante personnelle' })
        .set('Authorization', `Bearer ${otherTechnicianToken}`)
        .expect(200);
      expect(notFound.body.some((row: any) => row.id === res.body.id)).toBe(
        false,
      );
      await apiRequest(app)
        .get(`/knowledge/documents/${res.body.id}`)
        .set('Authorization', `Bearer ${otherTechnicianToken}`)
        .expect(403);

      // Le propriétaire, lui, peut le consulter et le retirer.
      await apiRequest(app)
        .get(`/knowledge/documents/${res.body.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      await apiRequest(app)
        .delete(`/knowledge/documents/${res.body.id}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
    });

    it('lets an ADMIN upload a level-1 (public) document, visible to an EMPLOYEE', async () => {
      const res = await apiRequest(app)
        .post('/knowledge/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'FAQ publique VPN',
          content:
            'Procédure publique de connexion VPN pour tous les employés.',
          knowledgeLevel: 1,
        })
        .expect(201);

      expect(res.body.knowledgeLevel).toBe(1);

      const found = await apiRequest(app)
        .get('/knowledge/search')
        .query({ q: 'connexion vpn publique' })
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(200);
      expect(
        found.body.some(
          (row: any) => row.sourceType === 'DOCUMENT' && row.id === res.body.id,
        ),
      ).toBe(true);

      await apiRequest(app)
        .delete(`/knowledge/documents/${res.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('rejects an ADMIN specifying level 3 or 5 (auto-indexed elsewhere, not uploadable)', async () => {
      await apiRequest(app)
        .post('/knowledge/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'x',
          content: 'Contenu suffisamment long',
          knowledgeLevel: 5,
        })
        .expect(400);
    });

    it('returns 404 for an unknown document id', async () => {
      await apiRequest(app)
        .get('/knowledge/documents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
