import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { apiRequest } from './support/api-request';
import type { App } from 'supertest/types';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { Role } from '../generated/prisma/client';

// docs/06-cas-utilisation.md UC-031 étape 3, docs/05-user-stories.md US-13,
// docs/11-documentation-api.md §3 (PATCH /users/:id/specialties).
describe('Users specialties (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const adminEmail = 'e2e-users-specialties-admin@test.com';
  const employeeEmail = 'e2e-users-specialties-employee@test.com';
  const technicianEmail = 'e2e-users-specialties-technician@test.com';
  const password = 'CorrectHorseBattery1!';

  let adminToken: string;
  let employeeToken: string;
  let employeeId: string;
  let technicianId: string;
  let categoryId: string;
  let otherCategoryId: string;

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

    const [, employee, technician, category, otherCategory] = await Promise.all(
      [
        prisma.user.create({
          data: {
            email: adminEmail,
            passwordHash,
            displayName: 'E2E Specialties Admin',
            role: Role.ADMIN,
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            email: employeeEmail,
            passwordHash,
            displayName: 'E2E Specialties Employee',
            role: Role.EMPLOYEE,
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            email: technicianEmail,
            passwordHash,
            displayName: 'E2E Specialties Technician',
            role: Role.TECHNICIAN,
            isActive: true,
          },
        }),
        prisma.ticketCategory.create({
          data: { name: 'E2E Specialties Category' },
        }),
        prisma.ticketCategory.create({
          data: { name: 'E2E Specialties Other Category' },
        }),
      ],
    );

    employeeId = employee.id;
    technicianId = technician.id;
    categoryId = category.id;
    otherCategoryId = otherCategory.id;

    [adminToken, employeeToken] = await Promise.all([
      loginAs(adminEmail),
      loginAs(employeeEmail),
    ]);
  });

  afterAll(async () => {
    await prisma.technicianSpecialty.deleteMany({
      where: { userId: technicianId },
    });

    const userEmails = [adminEmail, employeeEmail, technicianEmail];
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: userEmails } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
    await prisma.ticketCategory.deleteMany({
      where: { id: { in: [categoryId, otherCategoryId] } },
    });

    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
      await job.stop();
    }
    await app.close();
  });

  it('rejects a non-ADMIN', async () => {
    await apiRequest(app)
      .patch(`/users/${technicianId}/specialties`)
      .set('Authorization', `Bearer ${employeeToken}`)
      .send({ categoryIds: [categoryId] })
      .expect(403);
  });

  it('returns 404 for an unknown user id', async () => {
    await apiRequest(app)
      .patch('/users/00000000-0000-0000-0000-000000000000/specialties')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryIds: [categoryId] })
      .expect(404);
  });

  it('rejects assigning specialties to a non-TECHNICIAN', async () => {
    await apiRequest(app)
      .patch(`/users/${employeeId}/specialties`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryIds: [categoryId] })
      .expect(400);
  });

  it('rejects an unknown category id', async () => {
    await apiRequest(app)
      .patch(`/users/${technicianId}/specialties`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryIds: ['00000000-0000-0000-0000-000000000000'] })
      .expect(400);
  });

  it('assigns one or more specialties to a technician', async () => {
    const res = await apiRequest(app)
      .patch(`/users/${technicianId}/specialties`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryIds: [categoryId, otherCategoryId] })
      .expect(200);

    const assignedCategoryIds = res.body.specialties.map(
      (s: any) => s.categoryId,
    );
    expect(assignedCategoryIds.sort()).toEqual(
      [categoryId, otherCategoryId].sort(),
    );

    const fetched = await apiRequest(app)
      .get(`/users/${technicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(fetched.body.specialties).toHaveLength(2);
  });

  it('replaces the specialty set (not additive) and clears it with an empty array', async () => {
    await apiRequest(app)
      .patch(`/users/${technicianId}/specialties`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryIds: [categoryId] })
      .expect(200);

    const replaced = await apiRequest(app)
      .get(`/users/${technicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(replaced.body.specialties).toHaveLength(1);
    expect(replaced.body.specialties[0].categoryId).toBe(categoryId);

    await apiRequest(app)
      .patch(`/users/${technicianId}/specialties`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ categoryIds: [] })
      .expect(200);

    const cleared = await apiRequest(app)
      .get(`/users/${technicianId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(cleared.body.specialties).toEqual([]);
  });

  // docs/05-user-stories.md US-13 : le technicien spécialisé est préféré au
  // technicien simplement rattaché à l'équipe de la catégorie.
  describe('specialty-priority auto-assignment', () => {
    const employeeId2Email = 'e2e-users-specialties-employee2@test.com';
    let employee2Id: string;
    let employee2Token: string;
    let priorityId: string;
    let teamTechId: string;
    let teamId: string;
    let createdTicketId: string | undefined;

    beforeAll(async () => {
      const passwordHash = await bcrypt.hash(password, 10);
      const [employee2, teamTech, priority] = await Promise.all([
        prisma.user.create({
          data: {
            email: employeeId2Email,
            passwordHash,
            displayName: 'E2E Specialties Employee 2',
            role: Role.EMPLOYEE,
            isActive: true,
          },
        }),
        prisma.user.create({
          data: {
            email: 'e2e-users-specialties-team-tech@test.com',
            passwordHash,
            displayName: 'E2E Specialties Team Technician',
            role: Role.TECHNICIAN,
            isActive: true,
          },
        }),
        prisma.priority.create({
          data: { name: 'E2E Specialties Priority', level: 994 },
        }),
      ]);
      employee2Id = employee2.id;
      teamTechId = teamTech.id;
      priorityId = priority.id;

      teamId = (
        await prisma.team.create({
          data: { name: 'E2E Specialties Team', categoryId },
        })
      ).id;
      await prisma.user.update({
        where: { id: teamTechId },
        data: { teamId },
      });

      await apiRequest(app)
        .patch(`/users/${technicianId}/specialties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ categoryIds: [categoryId] })
        .expect(200);

      employee2Token = await loginAs(employeeId2Email);
    });

    afterAll(async () => {
      if (createdTicketId) {
        await prisma.ticketStatusHistory.deleteMany({
          where: { ticketId: createdTicketId },
        });
        await prisma.ticket.deleteMany({ where: { id: createdTicketId } });
      }
      await prisma.user.update({
        where: { id: teamTechId },
        data: { teamId: null },
      });
      await prisma.team.delete({ where: { id: teamId } });
      await prisma.priority.delete({ where: { id: priorityId } });
      await prisma.refreshToken.deleteMany({
        where: {
          user: {
            email: {
              in: [
                employeeId2Email,
                'e2e-users-specialties-team-tech@test.com',
              ],
            },
          },
        },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [employee2Id, teamTechId] } },
      });
    });

    it('assigns the ticket to the specialist technician rather than the team-matched one', async () => {
      const res = await apiRequest(app)
        .post('/tickets')
        .set('Authorization', `Bearer ${employee2Token}`)
        .send({
          categoryId,
          priorityId,
          title: 'Ticket pour tester la priorité de spécialité',
        })
        .expect(201);

      createdTicketId = res.body.id;
      expect(res.body.technicianId).toBe(technicianId);
    });
  });
});
