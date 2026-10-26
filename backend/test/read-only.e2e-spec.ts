import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';
import { MASKED_EMAIL } from '../src/auth/interceptors/read-only-redaction.interceptor';

// Mocks the Anthropic SDK so the diagnostic call below never hits the real
// API — see test/support/anthropic-mock.ts.
jest.mock('@anthropic-ai/sdk', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./support/anthropic-mock').anthropicSdkMockFactory(),
);

// Compte de démonstration (User.isReadOnly) : vérifie de bout en bout, à
// travers JwtAuthGuard, ce que les tests unitaires de ReadOnlyGuard
// vérifient isolément.
describe('Read-only account (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const readOnlyEmail = 'e2e-read-only-supervisor@test.com';
  const employeeEmail = 'e2e-read-only-employee@test.com';
  const password = 'CorrectHorseBattery1!';

  let readOnlyId: string;
  let employeeId: string;
  let token: string;
  let ticketId: string;
  let priorityId: string;

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

    const [readOnly, employee] = await Promise.all([
      prisma.user.create({
        data: {
          email: readOnlyEmail,
          passwordHash,
          displayName: 'E2E Read-only Supervisor',
          role: Role.SUPERVISOR,
          isReadOnly: true,
        },
      }),
      prisma.user.create({
        data: {
          email: employeeEmail,
          passwordHash,
          displayName: 'E2E Read-only Employee',
          role: Role.EMPLOYEE,
        },
      }),
    ]);
    readOnlyId = readOnly.id;
    employeeId = employee.id;

    const [category, priority] = await Promise.all([
      prisma.ticketCategory.findFirstOrThrow(),
      prisma.priority.findFirstOrThrow(),
    ]);
    priorityId = priority.id;
    const ticket = await prisma.ticket.create({
      data: {
        reference: `TCK-E2E-RO-${Date.now()}`,
        title: 'E2E read-only ticket',
        employeeId,
        categoryId: category.id,
        priorityId: priority.id,
      },
    });
    ticketId = ticket.id;

    const res = await apiRequest(app)
      .post('/auth/login')
      .send({ email: readOnlyEmail, password })
      .expect(200);
    expect(res.body.user.isReadOnly).toBe(true);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.aiConversation.deleteMany({ where: { userId: readOnlyId } });
    await prisma.ticket.deleteMany({ where: { id: ticketId } });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: [readOnlyId, employeeId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [readOnlyId, employeeId] } },
    });
    await app.close();
  });

  it('rejects writes the role would otherwise allow', async () => {
    await apiRequest(app)
      .post('/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'E2E read-only team' })
      .expect(403);
    await apiRequest(app)
      .patch(`/sla-policies/${priorityId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ resolutionHours: 1 })
      .expect(403);
    await apiRequest(app)
      .patch(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CLOSED' })
      .expect(403);

    const sla = await prisma.slaPolicy.findUnique({ where: { priorityId } });
    expect(sla?.resolutionHours).not.toBe(1);
  });

  it('accepts the allow-listed AI diagnostic', async () => {
    const res = await apiRequest(app)
      .post('/diagnostics')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: "Mon imprimante n'imprime plus depuis ce matin" })
      .expect(201);
    expect(res.body.conversationId).toEqual(expect.any(String));
  });

  it('rejects sensitive reads', async () => {
    for (const path of ['/users', '/audit-logs', '/admin/settings']) {
      await apiRequest(app)
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    }
  });

  it('serves ordinary reads with other users emails masked', async () => {
    const res = await apiRequest(app)
      .get(`/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.employee.email).toBe(MASKED_EMAIL);
    expect(JSON.stringify(res.body)).not.toContain(employeeEmail);
  });

  it('can still sign out', async () => {
    await apiRequest(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
