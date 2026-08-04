import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ApprovalStatus,
  AutomationRunStatus,
  AutoResolutionStatus,
  Role,
  ScriptLanguage,
  TicketStatus,
} from '../generated/prisma/client';

// docs/06-cas-utilisation.md UC-014/UC-022, docs/09-architecture-agents-ia.md
// §3.5, docs/11-documentation-api.md §8 — module Automation : exécution
// directe des scripts non sensibles, approbation humaine obligatoire pour
// les scripts sensibles (RM-01), et restriction de l'approbation aux
// SUPERVISOR/ADMIN ou aux TECHNICIAN explicitement habilités.
describe('Automation (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const requesterEmail = 'e2e-automation-requester@test.com';
  const habiliteEmail = 'e2e-automation-habilite@test.com';
  const plainTechEmail = 'e2e-automation-plain-tech@test.com';
  const adminEmail = 'e2e-automation-admin@test.com';
  const employeeEmail = 'e2e-automation-employee@test.com';
  const password = 'CorrectHorseBattery1!';

  let requesterId: string;
  let habiliteId: string;
  let employeeId: string;

  let requesterToken: string;
  let habiliteToken: string;
  let plainTechToken: string;
  let adminToken: string;
  let employeeToken: string;

  let nonSensitiveScriptId: string;
  let sensitiveScriptId: string;
  let autoResolveScriptId: string;
  let categoryId: string;
  let priorityId: string;
  let accountTicketId: string;
  let unrelatedTicketId: string;
  let autoResolveFallbackTicketId: string | undefined;

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

    const [requester, habilite, , , employee] = await Promise.all([
      prisma.user.create({
        data: {
          email: requesterEmail,
          passwordHash,
          displayName: 'E2E Automation Requester',
          role: Role.TECHNICIAN,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: habiliteEmail,
          passwordHash,
          displayName: 'E2E Automation Habilité',
          role: Role.TECHNICIAN,
          isActive: true,
          canApproveAutomations: true,
        },
      }),
      prisma.user.create({
        data: {
          email: plainTechEmail,
          passwordHash,
          displayName: 'E2E Automation Plain Tech',
          role: Role.TECHNICIAN,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          displayName: 'E2E Automation Admin',
          role: Role.ADMIN,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: employeeEmail,
          passwordHash,
          displayName: 'E2E Automation Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
    ]);
    employeeId = employee.id;

    requesterId = requester.id;
    habiliteId = habilite.id;

    const [category, priority] = await Promise.all([
      prisma.ticketCategory.create({
        data: { name: 'E2E Automation Category' },
      }),
      prisma.priority.create({
        data: { name: 'E2E Automation Priority', level: 995 },
      }),
    ]);
    categoryId = category.id;
    priorityId = priority.id;

    // docs/05-user-stories.md US-28 fixtures. employeeId reuses the
    // requester technician's id: RM-04 ownership isn't what's under test
    // here, only the suggestion logic, so a dedicated employee user isn't
    // needed.
    const [accountTicket, unrelatedTicket] = await Promise.all([
      prisma.ticket.create({
        data: {
          reference: 'TCK-E2E-AUTOMATION-SUGGEST-0001',
          employeeId: requesterId,
          categoryId,
          priorityId,
          title: 'Mot de passe oublié, compte verrouillé',
          summary:
            'Utilisateur bloqué après plusieurs tentatives de connexion.',
          status: TicketStatus.NEW,
        },
      }),
      prisma.ticket.create({
        data: {
          reference: 'TCK-E2E-AUTOMATION-SUGGEST-0002',
          employeeId: requesterId,
          categoryId,
          priorityId,
          title: 'Question générale sur la politique de télétravail',
          summary: 'Aucun rapport avec un script disponible.',
          status: TicketStatus.NEW,
        },
      }),
    ]);
    accountTicketId = accountTicket.id;
    unrelatedTicketId = unrelatedTicket.id;

    // docs/06-cas-utilisation.md UC-015 : script non sensible dédié, avec un
    // nom/contenu volontairement sans ambiguïté pour que l'évaluation IA
    // réelle (confiance >= 95%) soit fiable en test.
    const autoResolveScript = await prisma.script.create({
      data: {
        name: "Vider le cache du spouleur d'impression",
        language: ScriptLanguage.POWERSHELL,
        content:
          'Stop-Service Spooler; Remove-Item "$env:SystemRoot\\System32\\spool\\PRINTERS\\*" -Force; Start-Service Spooler',
        isSensitive: false,
      },
    });
    autoResolveScriptId = autoResolveScript.id;

    [requesterToken, habiliteToken, plainTechToken, adminToken, employeeToken] =
      await Promise.all([
        loginAs(requesterEmail),
        loginAs(habiliteEmail),
        loginAs(plainTechEmail),
        loginAs(adminEmail),
        loginAs(employeeEmail),
      ]);
  });

  afterAll(async () => {
    await prisma.approval.deleteMany({
      where: { automationRun: { requestedById: requesterId } },
    });
    await prisma.automationRun.deleteMany({
      where: { requestedById: requesterId },
    });
    await prisma.knowledgeArticle.deleteMany({
      where: { autoResolution: { employeeId } },
    });
    await prisma.autoResolution.deleteMany({ where: { employeeId } });
    if (autoResolveFallbackTicketId) {
      await prisma.ticket.deleteMany({
        where: { id: autoResolveFallbackTicketId },
      });
    }
    if (nonSensitiveScriptId)
      await prisma.script.deleteMany({ where: { id: nonSensitiveScriptId } });
    if (sensitiveScriptId)
      await prisma.script.deleteMany({ where: { id: sensitiveScriptId } });
    await prisma.script.deleteMany({ where: { id: autoResolveScriptId } });
    await prisma.ticket.deleteMany({
      where: { id: { in: [accountTicketId, unrelatedTicketId] } },
    });
    await prisma.ticketCategory.delete({ where: { id: categoryId } });
    await prisma.priority.delete({ where: { id: priorityId } });

    // La confirmation d'une résolution automatique échouée (repli) appelle
    // aiService.diagnoseTicket, qui persiste une AiConversation (FK
    // RESTRICT sur user_id) — à retirer avant de supprimer l'employé.
    await prisma.aiConversation.deleteMany({ where: { userId: employeeId } });

    const userEmails = [
      requesterEmail,
      habiliteEmail,
      plainTechEmail,
      adminEmail,
      employeeEmail,
    ];
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: userEmails } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: userEmails } } });

    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });

  it('rejects script creation from a non-ADMIN', async () => {
    await apiRequest(app)
      .post('/automation/scripts')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        name: 'Devrait être rejeté',
        language: ScriptLanguage.BASH,
        content: 'echo test',
      })
      .expect(403);
  });

  it('lets an ADMIN create a non-sensitive and a sensitive script', async () => {
    const nonSensitive = await apiRequest(app)
      .post('/automation/scripts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Vider le cache DNS',
        language: ScriptLanguage.POWERSHELL,
        content: 'Clear-DnsClientCache',
        isSensitive: false,
      })
      .expect(201);
    nonSensitiveScriptId = nonSensitive.body.id;
    expect(nonSensitive.body.isSensitive).toBe(false);

    const sensitive = await apiRequest(app)
      .post('/automation/scripts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'E2E Réinitialiser le mot de passe',
        language: ScriptLanguage.POWERSHELL,
        content: 'Set-ADAccountPassword ...',
      })
      .expect(201);
    sensitiveScriptId = sensitive.body.id;
    // isSensitive defaults to true server-side when omitted (RM-01).
    expect(sensitive.body.isSensitive).toBe(true);
  });

  // docs/05-user-stories.md US-28. Timeout raised: hits the real Anthropic
  // API (or falls back locally), slower than Jest's 5s default.
  describe('suggest (US-28)', () => {
    it('suggests the matching script and a justification for an account-related ticket', async () => {
      const res = await apiRequest(app)
        .get(`/automation/suggest/${accountTicketId}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(200);

      expect(res.body.scriptId).toBe(sensitiveScriptId);
      expect(typeof res.body.justification).toBe('string');
      expect(res.body.justification.length).toBeGreaterThan(0);
    }, 30000);

    it('returns 404 when nothing matches the ticket', async () => {
      await apiRequest(app)
        .get(`/automation/suggest/${unrelatedTicketId}`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .expect(404);
    }, 30000);

    it('forbids a non-TECHNICIAN from requesting a suggestion', async () => {
      await apiRequest(app)
        .get(`/automation/suggest/${accountTicketId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403);
    });
  });

  it('lists scripts for a TECHNICIAN', async () => {
    const res = await apiRequest(app)
      .get('/automation/scripts')
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.some((s: any) => s.id === nonSensitiveScriptId)).toBe(true);
  });

  let nonSensitiveRunId: string;

  it('executes a non-sensitive script run immediately, without approval', async () => {
    const res = await apiRequest(app)
      .post('/automation/runs')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        scriptId: nonSensitiveScriptId,
        justification: 'Nettoyage de routine',
      })
      .expect(201);

    expect(res.body.status).toBe(AutomationRunStatus.SUCCESS);
    expect(res.body.executedById).toBeNull();
    nonSensitiveRunId = res.body.id;
  });

  it('forbids an unrelated technician from viewing someone else’s run', async () => {
    await apiRequest(app)
      .get(`/automation/runs/${nonSensitiveRunId}`)
      .set('Authorization', `Bearer ${plainTechToken}`)
      .expect(403);
  });

  let approvalId: string;

  it('creates a pending approval for a sensitive script instead of executing it', async () => {
    const res = await apiRequest(app)
      .post('/automation/runs')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        scriptId: sensitiveScriptId,
        justification: 'Compte verrouillé après 5 tentatives',
      })
      .expect(201);

    expect(res.body.status).toBe(AutomationRunStatus.PENDING_APPROVAL);
    expect(res.body.approval.status).toBe(ApprovalStatus.PENDING);
    approvalId = res.body.approval.id;
  });

  it('forbids a non-habilité technician from viewing the pending approvals queue', async () => {
    await apiRequest(app)
      .get('/automation/approvals/pending')
      .set('Authorization', `Bearer ${plainTechToken}`)
      .expect(403);
  });

  it('lets a habilité technician see the pending approval', async () => {
    const res = await apiRequest(app)
      .get('/automation/approvals/pending')
      .set('Authorization', `Bearer ${habiliteToken}`)
      .expect(200);

    expect(res.body.some((a: any) => a.id === approvalId)).toBe(true);
  });

  it('forbids the requester from approving their own request', async () => {
    await apiRequest(app)
      .patch(`/automation/approvals/${approvalId}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ decision: ApprovalStatus.APPROVED })
      .expect(403);
  });

  it('lets the habilité technician approve the sensitive run, which then executes it', async () => {
    const res = await apiRequest(app)
      .patch(`/automation/approvals/${approvalId}`)
      .set('Authorization', `Bearer ${habiliteToken}`)
      .send({ decision: ApprovalStatus.APPROVED })
      .expect(200);

    expect(res.body.status).toBe(AutomationRunStatus.SUCCESS);
    expect(res.body.executedById).toBe(habiliteId);
  });

  it('rejects deciding an approval that was already processed', async () => {
    await apiRequest(app)
      .patch(`/automation/approvals/${approvalId}`)
      .set('Authorization', `Bearer ${habiliteToken}`)
      .send({ decision: ApprovalStatus.REJECTED })
      .expect(400);
  });

  it('marks a rejected run as REJECTED without executing it', async () => {
    const created = await apiRequest(app)
      .post('/automation/runs')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        scriptId: sensitiveScriptId,
        justification: 'Deuxième tentative, à rejeter',
      })
      .expect(201);

    const res = await apiRequest(app)
      .patch(`/automation/approvals/${created.body.approval.id}`)
      .set('Authorization', `Bearer ${habiliteToken}`)
      .send({ decision: ApprovalStatus.REJECTED, note: 'Cible incorrecte' })
      .expect(200);

    expect(res.body.status).toBe(AutomationRunStatus.REJECTED);
    expect(res.body.executedById).toBeNull();
  });

  // docs/06-cas-utilisation.md UC-015 ("Résolution automatique"), RM-03.
  // Timeout raised: hits the real Anthropic API.
  describe('auto-resolve (UC-015)', () => {
    it('rejects a non-EMPLOYEE on both routes', async () => {
      await apiRequest(app)
        .post('/automation/auto-resolve')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ description: 'Le cache du spouleur est plein.' })
        .expect(403);

      await apiRequest(app)
        .post('/automation/auto-resolve/confirm')
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          description: 'Le cache du spouleur est plein.',
          scriptId: autoResolveScriptId,
          confidence: 0.97,
        })
        .expect(403);
    });

    it('proposes eligible=false for a problem that matches no non-sensitive script', async () => {
      const res = await apiRequest(app)
        .post('/automation/auto-resolve')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          description:
            "J'ai une question générale sur la politique de télétravail de l'entreprise.",
        })
        .expect(201);

      expect(res.body.eligible).toBe(false);
    }, 30000);

    it('proposes an eligible auto-resolution for a clear, unambiguous match, then executes it on confirm (no ticket created)', async () => {
      const proposal = await apiRequest(app)
        .post('/automation/auto-resolve')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          description:
            "Le cache du spouleur d'impression est plein et bloque toutes les impressions, il faut le vider.",
        })
        .expect(201);

      expect(proposal.body.eligible).toBe(true);
      expect(proposal.body.scriptId).toBe(autoResolveScriptId);
      expect(proposal.body.confidence).toBeGreaterThanOrEqual(0.95);

      const confirmed = await apiRequest(app)
        .post('/automation/auto-resolve/confirm')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          description:
            "Le cache du spouleur d'impression est plein et bloque toutes les impressions, il faut le vider.",
          scriptId: proposal.body.scriptId,
          confidence: proposal.body.confidence,
        })
        .expect(201);

      expect(confirmed.body.status).toBe(AutoResolutionStatus.RESOLVED);
      expect(confirmed.body.ticketId).toBeUndefined();

      const autoResolution = await prisma.autoResolution.findUnique({
        where: { id: confirmed.body.autoResolutionId },
      });
      expect(autoResolution?.status).toBe(AutoResolutionStatus.RESOLVED);

      const article = await prisma.knowledgeArticle.findUnique({
        where: { autoResolutionId: confirmed.body.autoResolutionId },
      });
      expect(article?.status).toBe('PROPOSED');
    }, 30000);

    // docs/06-cas-utilisation.md UC-015, cas d'erreur : RM-03 est revérifié
    // à la confirmation — un script devenu sensible depuis la proposition
    // fait basculer sur un ticket standard avec le contexte de la tentative.
    it('falls back to creating a standard ticket when the proposed script has since become sensitive', async () => {
      await prisma.script.update({
        where: { id: autoResolveScriptId },
        data: { isSensitive: true },
      });

      try {
        const res = await apiRequest(app)
          .post('/automation/auto-resolve/confirm')
          .set('Authorization', `Bearer ${employeeToken}`)
          .send({
            description:
              "Le cache du spouleur d'impression est plein et bloque toutes les impressions.",
            scriptId: autoResolveScriptId,
            confidence: 0.97,
          })
          .expect(201);

        expect(res.body.status).toBe(AutoResolutionStatus.FAILED_FALLBACK);
        expect(res.body.ticketId).toEqual(expect.any(String));
        autoResolveFallbackTicketId = res.body.ticketId;

        const ticket = await prisma.ticket.findUnique({
          where: { id: res.body.ticketId },
        });
        expect(ticket).not.toBeNull();
        expect(ticket?.summary).toContain(
          'Tentative de résolution automatique échouée',
        );

        const autoResolution = await prisma.autoResolution.findUnique({
          where: { id: res.body.autoResolutionId },
        });
        expect(autoResolution?.status).toBe(
          AutoResolutionStatus.FAILED_FALLBACK,
        );
        expect(autoResolution?.fallbackTicketId).toBe(res.body.ticketId);
      } finally {
        await prisma.script.update({
          where: { id: autoResolveScriptId },
          data: { isSensitive: false },
        });
      }
    }, 30000);

    it('returns 404 when the script no longer exists', async () => {
      await apiRequest(app)
        .post('/automation/auto-resolve/confirm')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          description: 'Un problème quelconque, script inexistant.',
          scriptId: '00000000-0000-0000-0000-000000000000',
          confidence: 0.97,
        })
        .expect(404);
    });
  });
});
