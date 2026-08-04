import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
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
  const technicianEmail = 'e2e-ci-technician@test.com';
  const password = 'CorrectHorseBattery1!';

  let ciTypeId: string;
  let categoryId: string;
  let priorityId: string;
  let employeeId: string;
  let ciId: string;
  let dependentCiId: string;
  let teamId: string;
  let manufacturerId: string;
  let warrantyCiId: string;
  const reliabilityCiIds: string[] = [];
  const licenseCiIds: string[] = [];

  let employeeToken: string;
  let supervisorToken: string;
  let technicianToken: string;

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

    const [employee, , , ciType, category, priority] = await Promise.all([
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
      prisma.user.create({
        data: {
          email: technicianEmail,
          passwordHash,
          displayName: 'E2E CI Technician',
          role: Role.TECHNICIAN,
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

    [employeeToken, supervisorToken, technicianToken] = await Promise.all([
      loginAs(employeeEmail),
      loginAs(supervisorEmail),
      loginAs(technicianEmail),
    ]);

    // The ticket created below has no technicianId, so TicketsService
    // auto-assigns it (BR-03/US-13). With no team for this category, that
    // fallback would scan every active TECHNICIAN in the real Postgres
    // instance — and e2e spec files run in parallel Jest workers against
    // that same shared database, so it could pick up a technician fixture
    // from a different, concurrently running spec file. An empty team tied
    // to this category keeps the ticket deterministically unassigned instead.
    teamId = (
      await prisma.team.create({ data: { name: 'E2E CI Team', categoryId } })
    ).id;
  });

  afterAll(async () => {
    await prisma.ticket.deleteMany({ where: { employeeId } });
    await prisma.ciRelationship.deleteMany({
      where: { OR: [{ parentCiId: ciId }, { childCiId: ciId }] },
    });
    if (ciId)
      await prisma.configurationItem.deleteMany({
        where: {
          id: {
            in: [
              ciId,
              dependentCiId,
              warrantyCiId,
              ...reliabilityCiIds,
              ...licenseCiIds,
            ].filter(Boolean),
          },
        },
      });
    await prisma.warranty.deleteMany({
      where: { provider: { startsWith: 'E2E CI' } },
    });
    await prisma.license.deleteMany({
      where: { vendor: { startsWith: 'E2E CI' } },
    });
    await prisma.model.deleteMany({
      where: { manufacturer: { name: { startsWith: 'E2E CI' } } },
    });
    await prisma.manufacturer.deleteMany({
      where: { name: { startsWith: 'E2E CI' } },
    });
    await prisma.ciType.delete({ where: { id: ciTypeId } });
    await prisma.team.delete({ where: { id: teamId } });
    await prisma.ticketCategory.delete({ where: { id: categoryId } });
    await prisma.priority.delete({ where: { id: priorityId } });
    await prisma.refreshToken.deleteMany({
      where: {
        user: {
          email: { in: [employeeEmail, supervisorEmail, technicianEmail] },
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: [employeeEmail, supervisorEmail, technicianEmail] },
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

  it('rejects CI creation from an EMPLOYEE', async () => {
    await apiRequest(app)
      .post('/configuration-items')
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ ciTypeId, name: 'SRV-E2E-01', inventoryNumber: 'INV-E2E-0001' })
      .expect(403);
  });

  it('lets a SUPERVISOR create a Configuration Item', async () => {
    const res = await apiRequest(app)
      .post('/configuration-items')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ ciTypeId, name: 'SRV-E2E-01', inventoryNumber: 'INV-E2E-0001' })
      .expect(201);

    expect(res.body.name).toBe('SRV-E2E-01');
    expect(res.body.ciType.id).toBe(ciTypeId);
    ciId = res.body.id;
  });

  it('rejects a second CI with the same inventory number', async () => {
    await apiRequest(app)
      .post('/configuration-items')
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ ciTypeId, name: 'SRV-E2E-02', inventoryNumber: 'INV-E2E-0001' })
      .expect(409);
  });

  it('allows an EMPLOYEE to list Configuration Items (needed to pick one when creating a ticket)', async () => {
    const res = await apiRequest(app)
      .get('/configuration-items')
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);

    expect(res.body.some((ci: any) => ci.id === ciId)).toBe(true);
  });

  let ticketId: string;

  it('links a ticket to the Configuration Item on creation', async () => {
    const res = await apiRequest(app)
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
    const res = await apiRequest(app)
      .get(`/configuration-items/${ciId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(res.body.tickets.some((t: any) => t.id === ticketId)).toBe(true);
  });

  it('lets a SUPERVISOR update the CI status and audit-logs the change', async () => {
    const res = await apiRequest(app)
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

  // US-24 : le technicien doit voir le fabricant/modèle et la garantie
  // d'un CI avant de décider réparer vs remplacer (docs/08 §4.3).
  describe('manufacturer, model and warranty', () => {
    it('rejects a model without a manufacturer', async () => {
      await apiRequest(app)
        .post('/configuration-items')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          ciTypeId,
          name: 'PC-E2E-01',
          inventoryNumber: 'INV-E2E-WARR-01',
          modelName: 'Latitude 5420',
        })
        .expect(400);
    });

    it('creates a CI with manufacturer, model and warranty in one call', async () => {
      const res = await apiRequest(app)
        .post('/configuration-items')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          ciTypeId,
          name: 'PC-E2E-01',
          inventoryNumber: 'INV-E2E-WARR-01',
          manufacturerName: 'E2E CI Dell',
          modelName: 'Latitude 5420',
          warranty: {
            provider: 'E2E CI Dell ProSupport',
            startDate: '2024-01-15',
            endDate: '2027-01-15',
            referenceNumber: 'WARR-E2E-001',
          },
        })
        .expect(201);

      expect(res.body.manufacturer.name).toBe('E2E CI Dell');
      expect(res.body.model.name).toBe('Latitude 5420');
      expect(res.body.warranty.provider).toBe('E2E CI Dell ProSupport');
      warrantyCiId = res.body.id;
      manufacturerId = res.body.manufacturer.id;
    });

    it('reuses the same manufacturer instead of duplicating it by name', async () => {
      const res = await apiRequest(app)
        .post('/configuration-items')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          ciTypeId,
          name: 'PC-E2E-02',
          inventoryNumber: 'INV-E2E-WARR-02',
          manufacturerName: 'E2E CI Dell',
        })
        .expect(201);

      expect(res.body.manufacturer.id).toBe(manufacturerId);
      await prisma.configurationItem.delete({ where: { id: res.body.id } });
    });

    it('lets a TECHNICIAN view the warranty to decide repair vs replace', async () => {
      const res = await apiRequest(app)
        .get(`/configuration-items/${warrantyCiId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);

      expect(res.body.warranty.referenceNumber).toBe('WARR-E2E-001');
    });

    it('updates the existing warranty in place rather than creating a new one', async () => {
      const before = await apiRequest(app)
        .get(`/configuration-items/${warrantyCiId}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);
      const warrantyId = before.body.warranty.id;

      const res = await apiRequest(app)
        .patch(`/configuration-items/${warrantyCiId}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          warranty: {
            provider: 'E2E CI Dell ProSupport Plus',
            startDate: '2024-01-15',
            endDate: '2028-01-15',
          },
        })
        .expect(200);

      expect(res.body.warranty.id).toBe(warrantyId);
      expect(res.body.warranty.provider).toBe('E2E CI Dell ProSupport Plus');
    });

    it('clears the warranty when clearWarranty is sent', async () => {
      const res = await apiRequest(app)
        .patch(`/configuration-items/${warrantyCiId}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ clearWarranty: true })
        .expect(200);

      expect(res.body.warranty).toBeNull();
    });
  });

  // US-27 : analyse prédictive des pannes récurrentes par modèle, pour
  // anticiper les remplacements (docs/09 §3.6, Agent Manager).
  describe('model reliability', () => {
    it('rejects model reliability for an EMPLOYEE', async () => {
      await apiRequest(app)
        .get('/configuration-items/models/reliability')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('flags a model with a high recent ticket-per-CI ratio as at-risk', async () => {
      for (let i = 1; i <= 3; i += 1) {
        const ci = await apiRequest(app)
          .post('/configuration-items')
          .set('Authorization', `Bearer ${supervisorToken}`)
          .send({
            ciTypeId,
            name: `PC-E2E-REL-0${i}`,
            inventoryNumber: `INV-E2E-REL-0${i}`,
            manufacturerName: 'E2E CI Reliability Corp',
            modelName: 'ReliaBook X1',
          })
          .expect(201);
        reliabilityCiIds.push(ci.body.id);

        await apiRequest(app)
          .post('/tickets')
          .set('Authorization', `Bearer ${employeeToken}`)
          .send({
            categoryId,
            priorityId,
            ciId: ci.body.id,
            title: `E2E: panne récurrente ${i}`,
          })
          .expect(201);
      }

      const res = await apiRequest(app)
        .get('/configuration-items/models/reliability')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const entry = res.body.find(
        (item: any) => item.modelName === 'ReliaBook X1',
      );
      expect(entry).toBeDefined();
      expect(entry.ciCount).toBe(3);
      expect(entry.recentTicketCount).toBe(3);
      expect(entry.atRisk).toBe(true);
    });
  });

  // US-23 : consulter les licences et leur date d'expiration, pour
  // anticiper les renouvellements.
  describe('licenses', () => {
    it('rejects license listing for an EMPLOYEE', async () => {
      await apiRequest(app)
        .get('/configuration-items/licenses')
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('lists licenses sorted by soonest expiration, with a computed status', async () => {
      const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const valid = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const ciSoon = await apiRequest(app)
        .post('/configuration-items')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          ciTypeId,
          name: 'LIC-E2E-SOON',
          inventoryNumber: 'INV-E2E-LIC-01',
          license: { vendor: 'E2E CI Microsoft', expiresAt: soon },
        })
        .expect(201);
      licenseCiIds.push(ciSoon.body.id);

      const ciValid = await apiRequest(app)
        .post('/configuration-items')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          ciTypeId,
          name: 'LIC-E2E-VALID',
          inventoryNumber: 'INV-E2E-LIC-02',
          license: { vendor: 'E2E CI Adobe', expiresAt: valid },
        })
        .expect(201);
      licenseCiIds.push(ciValid.body.id);

      const res = await apiRequest(app)
        .get('/configuration-items/licenses')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const soonIndex = res.body.findIndex(
        (entry: any) => entry.ci.id === ciSoon.body.id,
      );
      const validIndex = res.body.findIndex(
        (entry: any) => entry.ci.id === ciValid.body.id,
      );
      expect(soonIndex).toBeGreaterThanOrEqual(0);
      expect(validIndex).toBeGreaterThan(soonIndex);
      expect(res.body[soonIndex].status).toBe('EXPIRING_SOON');
      expect(res.body[validIndex].status).toBe('VALID');
    });

    it('updates the existing license in place and clears it on clearLicense', async () => {
      const created = await apiRequest(app)
        .post('/configuration-items')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          ciTypeId,
          name: 'LIC-E2E-EDIT',
          inventoryNumber: 'INV-E2E-LIC-03',
          license: {
            vendor: 'E2E CI SAP',
            expiresAt: '2027-01-15',
          },
        })
        .expect(201);
      licenseCiIds.push(created.body.id);
      const licenseId = created.body.license.id;

      const updated = await apiRequest(app)
        .patch(`/configuration-items/${created.body.id}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          license: { vendor: 'E2E CI SAP Enterprise', expiresAt: '2028-01-15' },
        })
        .expect(200);
      expect(updated.body.license.id).toBe(licenseId);
      expect(updated.body.license.vendor).toBe('E2E CI SAP Enterprise');

      const cleared = await apiRequest(app)
        .patch(`/configuration-items/${created.body.id}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ clearLicense: true })
        .expect(200);
      expect(cleared.body.license).toBeNull();
    });
  });

  // docs/08-schema-base-de-donnees.md §4.3, docs/11-documentation-api.md
  // §9 (GET /inventory/cis/:id/impact) — "connaître l'impact d'un incident".
  describe('CI relationships and impact analysis', () => {
    let relationshipId: string;
    let dependentTicketId: string;

    it('rejects adding a relationship from an EMPLOYEE', async () => {
      const dependent = await apiRequest(app)
        .post('/configuration-items')
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({
          ciTypeId,
          name: 'APP-E2E-DEPENDENTE',
          inventoryNumber: 'INV-E2E-0002',
        })
        .expect(201);
      dependentCiId = dependent.body.id;

      await apiRequest(app)
        .post(`/configuration-items/${ciId}/relationships`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({ childCiId: dependentCiId, relationshipType: 'RUNS_ON' })
        .expect(403);
    });

    it('rejects a CI depending on itself', async () => {
      await apiRequest(app)
        .post(`/configuration-items/${ciId}/relationships`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ childCiId: ciId, relationshipType: 'RUNS_ON' })
        .expect(400);
    });

    it('lets a SUPERVISOR add a dependency relationship', async () => {
      const res = await apiRequest(app)
        .post(`/configuration-items/${ciId}/relationships`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .send({ childCiId: dependentCiId, relationshipType: 'RUNS_ON' })
        .expect(201);

      expect(res.body.child.id).toBe(dependentCiId);
      relationshipId = res.body.id;
    });

    it('rejects impact analysis for an EMPLOYEE', async () => {
      await apiRequest(app)
        .get(`/configuration-items/${ciId}/impact`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);
    });

    it('lets a TECHNICIAN see the dependent CI and its open tickets in the impact analysis', async () => {
      const dependentTicket = await apiRequest(app)
        .post('/tickets')
        .set('Authorization', `Bearer ${employeeToken}`)
        .send({
          categoryId,
          priorityId,
          ciId: dependentCiId,
          title: 'E2E: application RH inaccessible',
        })
        .expect(201);
      dependentTicketId = dependentTicket.body.id;

      const res = await apiRequest(app)
        .get(`/configuration-items/${ciId}/impact`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);

      expect(
        res.body.impactedCis.some(
          (entry: any) => entry.ci.id === dependentCiId,
        ),
      ).toBe(true);
      expect(
        res.body.affectedTickets.some((t: any) => t.id === dependentTicketId),
      ).toBe(true);
    });

    it('removes the relationship, which then disappears from the impact analysis', async () => {
      await apiRequest(app)
        .delete(`/configuration-items/${ciId}/relationships/${relationshipId}`)
        .set('Authorization', `Bearer ${supervisorToken}`)
        .expect(200);

      const res = await apiRequest(app)
        .get(`/configuration-items/${ciId}/impact`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);

      expect(res.body.impactedCis).toEqual([]);
    });
  });
});
