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
  const password = 'CorrectHorseBattery1!';

  let categoryId: string;
  let priorityId: string;
  let printerTicketId: string;
  let screenTicketId: string;
  let openTicketId: string;

  let employeeToken: string;
  let technicianToken: string;

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

    const [employee, , category, priority] = await Promise.all([
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

    printerTicketId = printerTicket.id;
    screenTicketId = screenTicket.id;
    openTicketId = openTicket.id;

    [employeeToken, technicianToken] = await Promise.all([
      loginAs(employeeEmail),
      loginAs(technicianEmail),
    ]);
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({
      where: { id: { in: [printerTicketId, screenTicketId, openTicketId] } },
    });
    await prisma.ticketCategory.delete({ where: { id: categoryId } });
    await prisma.priority.delete({ where: { id: priorityId } });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [employeeEmail, technicianEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [employeeEmail, technicianEmail] } },
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
});
