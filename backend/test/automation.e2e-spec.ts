import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ApprovalStatus,
  AutomationRunStatus,
  Role,
  ScriptLanguage,
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
  const password = 'CorrectHorseBattery1!';

  let requesterId: string;
  let habiliteId: string;

  let requesterToken: string;
  let habiliteToken: string;
  let plainTechToken: string;
  let adminToken: string;

  let nonSensitiveScriptId: string;
  let sensitiveScriptId: string;

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

    const [requester, habilite] = await Promise.all([
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
    ]);

    requesterId = requester.id;
    habiliteId = habilite.id;

    [requesterToken, habiliteToken, plainTechToken, adminToken] =
      await Promise.all([
        loginAs(requesterEmail),
        loginAs(habiliteEmail),
        loginAs(plainTechEmail),
        loginAs(adminEmail),
      ]);
  });

  afterAll(async () => {
    await prisma.approval.deleteMany({
      where: { automationRun: { requestedById: requesterId } },
    });
    await prisma.automationRun.deleteMany({
      where: { requestedById: requesterId },
    });
    if (nonSensitiveScriptId)
      await prisma.script.deleteMany({ where: { id: nonSensitiveScriptId } });
    if (sensitiveScriptId)
      await prisma.script.deleteMany({ where: { id: sensitiveScriptId } });

    const userEmails = [
      requesterEmail,
      habiliteEmail,
      plainTechEmail,
      adminEmail,
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
    await request(app.getHttpServer())
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
    const nonSensitive = await request(app.getHttpServer())
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

    const sensitive = await request(app.getHttpServer())
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

  it('lists scripts for a TECHNICIAN', async () => {
    const res = await request(app.getHttpServer())
      .get('/automation/scripts')
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);

    expect(res.body.some((s: any) => s.id === nonSensitiveScriptId)).toBe(true);
  });

  let nonSensitiveRunId: string;

  it('executes a non-sensitive script run immediately, without approval', async () => {
    const res = await request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .get(`/automation/runs/${nonSensitiveRunId}`)
      .set('Authorization', `Bearer ${plainTechToken}`)
      .expect(403);
  });

  let approvalId: string;

  it('creates a pending approval for a sensitive script instead of executing it', async () => {
    const res = await request(app.getHttpServer())
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
    await request(app.getHttpServer())
      .get('/automation/approvals/pending')
      .set('Authorization', `Bearer ${plainTechToken}`)
      .expect(403);
  });

  it('lets a habilité technician see the pending approval', async () => {
    const res = await request(app.getHttpServer())
      .get('/automation/approvals/pending')
      .set('Authorization', `Bearer ${habiliteToken}`)
      .expect(200);

    expect(res.body.some((a: any) => a.id === approvalId)).toBe(true);
  });

  it('forbids the requester from approving their own request', async () => {
    await request(app.getHttpServer())
      .patch(`/automation/approvals/${approvalId}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ decision: ApprovalStatus.APPROVED })
      .expect(403);
  });

  it('lets the habilité technician approve the sensitive run, which then executes it', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/automation/approvals/${approvalId}`)
      .set('Authorization', `Bearer ${habiliteToken}`)
      .send({ decision: ApprovalStatus.APPROVED })
      .expect(200);

    expect(res.body.status).toBe(AutomationRunStatus.SUCCESS);
    expect(res.body.executedById).toBe(habiliteId);
  });

  it('rejects deciding an approval that was already processed', async () => {
    await request(app.getHttpServer())
      .patch(`/automation/approvals/${approvalId}`)
      .set('Authorization', `Bearer ${habiliteToken}`)
      .send({ decision: ApprovalStatus.REJECTED })
      .expect(400);
  });

  it('marks a rejected run as REJECTED without executing it', async () => {
    const created = await request(app.getHttpServer())
      .post('/automation/runs')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({
        scriptId: sensitiveScriptId,
        justification: 'Deuxième tentative, à rejeter',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/automation/approvals/${created.body.approval.id}`)
      .set('Authorization', `Bearer ${habiliteToken}`)
      .send({ decision: ApprovalStatus.REJECTED, note: 'Cible incorrecte' })
      .expect(200);

    expect(res.body.status).toBe(AutomationRunStatus.REJECTED);
    expect(res.body.executedById).toBeNull();
  });
});
