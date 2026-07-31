import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

// docs/08-schema-base-de-donnees.md §4.3 (CMDB), docs/05-user-stories.md
// US-22/US-24: CI CRUD + lien vers les tickets (impact d'un incident).
describe('ConfigurationItems (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const employeeEmail = 'e2e-ci-employee@test.com';
  const supervisorEmail = 'e2e-ci-supervisor@test.com';
  const password = 'CorrectHorseBattery1!';

  let ciTypeId: string;
  let categoryId: string;
  let priorityId: string;
  let employeeId: string;
  let ciId: string;

  let employeeToken: string;
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

    const [employee, , ciType, category, priority] = await Promise.all([
      prisma.user.create({
        data: {
          email: employeeEmail,
          passwordHash,
          displayName: 'E2E CI Employee',
          role: Role.EMPLOYEE,
          isActive: true,
        },
      }),
      prisma.user.create({
        data: {
          email: supervisorEmail,
          passwordHash,
          displayName: 'E2E CI Supervisor',
          role: Role.SUPERVISOR,
          isActive: true,
        },
      }),
      prisma.ciType.create({ data: { name: 'E2E CI Type' } }),
      prisma.ticketCategory.create({ data: { name: 'E2E CI Category' } }),
      prisma.priority.create({ data: { name: 'E2E CI Priority', level: 997 } }),
    ]);

    employeeId = employee.id;
    ciTypeId = ciType.id;
    categoryId = category.id;
    priorityId = priority.id;

    [employeeToken, supervisorToken] = await Promise.all([
      loginAs(employeeEmail),
      loginAs(supervisorEmail),
    ]);
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { employeeId } });
    if (ciId)
      await prisma.configurationItem.deleteMany({ where: { id: ciId } });
    await prisma.ciType.delete({ where: { id: ciTypeId } });
    await prisma.ticketCategory.delete({ where: { id: categoryId } });
    await prisma.priority.delete({ where: { id: priorityId } });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: [employeeEmail, supervisorEmail] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [employeeEmail, supervisorEmail] } },
    });
    await app.close();
  });

  it('rejects CI creation from an EMPLOYEE', async () => {
    await request(app.getHttpServer())
      .post('/configuration-items')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ ciTypeId, name: 'SRV-E2E-01', inventoryNumber: 'INV-E2E-0001' })
      .expect(403);
  });

  it('lets a SUPERVISOR create a Configuration Item', async () => {
    const res = await request(app.getHttpServer())
      .post('/configuration-items')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ ciTypeId, name: 'SRV-E2E-01', inventoryNumber: 'INV-E2E-0001' })
      .expect(201);

    expect(res.body.name).toBe('SRV-E2E-01');
    expect(res.body.ciType.id).toBe(ciTypeId);
    ciId = res.body.id;
  });

  it('rejects a second CI with the same inventory number', async () => {
    await request(app.getHttpServer())
      .post('/configuration-items')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ ciTypeId, name: 'SRV-E2E-02', inventoryNumber: 'INV-E2E-0001' })
      .expect(409);
  });

  it('allows an EMPLOYEE to list Configuration Items (needed to pick one when creating a ticket)', async () => {
    const res = await request(app.getHttpServer())
      .get('/configuration-items')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    expect(res.body.some((ci: any) => ci.id === ciId)).toBe(true);
  });

  let ticketId: string;

  it('links a ticket to the Configuration Item on creation', async () => {
    const res = await request(app.getHttpServer())
      .post('/tickets')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({
        categoryId,
        priorityId,
        ciId,
        title: 'E2E: le serveur ne répond plus',
      })
      .expect(201);

    expect(res.body.ci.id).toBe(ciId);
    expect(res.body.ci.ciType.id).toBe(ciTypeId);
    ticketId = res.body.id;
  });

  it("shows the linked ticket in the Configuration Item's detail (impact assessment)", async () => {
    const res = await request(app.getHttpServer())
      .get(`/configuration-items/${ciId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(res.body.tickets.some((t: any) => t.id === ticketId)).toBe(true);
  });

  it('lets a SUPERVISOR update the CI status and audit-logs the change', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/configuration-items/${ciId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ status: 'IN_REPAIR' })
      .expect(200);

    expect(res.body.status).toBe('IN_REPAIR');

    const auditEntry = await prisma.auditLog.findFirst({
      where: { action: 'CI_UPDATED', targetId: ciId },
    });
    expect(auditEntry).not.toBeNull();
  });
});
