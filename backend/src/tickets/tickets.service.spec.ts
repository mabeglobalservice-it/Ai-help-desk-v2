import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { Prisma, Role, TicketStatus } from '../../generated/prisma/client';

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: {
    ticket: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    ticketStatusHistory: { create: jest.Mock };
    slaPolicy: { findUnique: jest.Mock };
    team: { findMany: jest.Mock };
    user: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let realtimeGateway: { emitToUser: jest.Mock; emitToRole: jest.Mock };
  let knowledgeService: { proposeArticleFromTicket: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticket: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      ticketStatusHistory: { create: jest.fn() },
      slaPolicy: { findUnique: jest.fn().mockResolvedValue(null) },
      team: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    realtimeGateway = { emitToUser: jest.fn(), emitToRole: jest.fn() };
    knowledgeService = {
      proposeArticleFromTicket: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: RealtimeGateway, useValue: realtimeGateway },
        { provide: KnowledgeService, useValue: knowledgeService },
      ],
    }).compile();

    service = module.get(TicketsService);
  });

  // docs/06-cas-utilisation.md RM-04
  describe('findAll (RM-04 scoping)', () => {
    it('forces employeeId to the requester for an EMPLOYEE, ignoring any technicianId filter', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      await service.findAll(
        { technicianId: 'someone-elses-id' },
        { userId: 'emp-1', role: Role.EMPLOYEE },
      );

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: 'emp-1',
            technicianId: 'someone-elses-id',
          }),
        }),
      );
    });

    it('forces technicianId to the requester for a TECHNICIAN, overriding any query.technicianId', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      await service.findAll(
        { technicianId: 'someone-elses-id' },
        { userId: 'tech-1', role: Role.TECHNICIAN },
      );

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: undefined,
            technicianId: 'tech-1',
          }),
        }),
      );
    });

    it('applies no forced ownership filter for SUPERVISOR/ADMIN', async () => {
      prisma.ticket.findMany.mockResolvedValue([]);

      await service.findAll(
        { technicianId: 'tech-9' },
        { userId: 'sup-1', role: Role.SUPERVISOR },
      );

      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            employeeId: undefined,
            technicianId: 'tech-9',
          }),
        }),
      );
    });
  });

  describe('findOne (RM-04 ownership)', () => {
    const ticket = {
      id: 'tkt-1',
      employeeId: 'emp-1',
      technicianId: 'tech-1',
      statusHistory: [],
    };

    it('throws NotFoundException when the ticket does not exist', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the ticket unconditionally when no requester is passed', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      await expect(service.findOne('tkt-1')).resolves.toBe(ticket);
    });

    it('allows an EMPLOYEE who owns the ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      await expect(
        service.findOne('tkt-1', { userId: 'emp-1', role: Role.EMPLOYEE }),
      ).resolves.toBe(ticket);
    });

    it('forbids an EMPLOYEE who does not own the ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      await expect(
        service.findOne('tkt-1', { userId: 'emp-2', role: Role.EMPLOYEE }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a TECHNICIAN assigned to the ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      await expect(
        service.findOne('tkt-1', { userId: 'tech-1', role: Role.TECHNICIAN }),
      ).resolves.toBe(ticket);
    });

    it('forbids a TECHNICIAN not assigned to the ticket', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      await expect(
        service.findOne('tkt-1', { userId: 'tech-2', role: Role.TECHNICIAN }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows a SUPERVISOR regardless of ownership', async () => {
      prisma.ticket.findUnique.mockResolvedValue(ticket);

      await expect(
        service.findOne('tkt-1', { userId: 'anyone', role: Role.SUPERVISOR }),
      ).resolves.toBe(ticket);
    });
  });

  describe('rate (UC-004)', () => {
    it('rejects a rating from someone other than the owning employee', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        employeeId: 'emp-1',
        technicianId: null,
        status: TicketStatus.RESOLVED,
        statusHistory: [],
      });

      await expect(
        service.rate('tkt-1', 'someone-else', { rating: 5 }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects rating a ticket that is not yet resolved', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        employeeId: 'emp-1',
        technicianId: null,
        status: TicketStatus.IN_PROGRESS,
        statusHistory: [],
      });

      await expect(
        service.rate('tkt-1', 'emp-1', { rating: 5 }),
      ).rejects.toThrow('Seul un ticket résolu peut être évalué');
    });

    it('accepts a rating from the owner once the ticket is resolved', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        employeeId: 'emp-1',
        technicianId: null,
        status: TicketStatus.RESOLVED,
        statusHistory: [],
      });
      prisma.ticket.update.mockResolvedValue({ id: 'tkt-1', rating: 5 });

      await service.rate('tkt-1', 'emp-1', { rating: 5, comment: 'Merci' });

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'tkt-1' },
          data: expect.objectContaining({ rating: 5, ratingComment: 'Merci' }),
        }),
      );
    });
  });

  describe('update', () => {
    const existing = {
      id: 'tkt-1',
      reference: 'TCK-2026-0001',
      employeeId: 'emp-1',
      technicianId: null,
      status: TicketStatus.NEW,
      priorityId: 'prio-faible',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      statusHistory: [],
    };

    beforeEach(() => {
      prisma.ticket.findUnique.mockResolvedValue(existing);
      prisma.$transaction.mockImplementation((fn: any) => {
        const tx = {
          ticket: { update: prisma.ticket.update },
          ticketStatusHistory: { create: prisma.ticketStatusHistory.create },
        };
        return fn(tx);
      });
    });

    it('forbids a TECHNICIAN updating a ticket not assigned to them', async () => {
      await expect(
        service.update(
          'tkt-1',
          { status: TicketStatus.IN_PROGRESS },
          'tech-2',
          Role.TECHNICIAN,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records a status-history entry and notifies both parties on a status change', async () => {
      const updated = {
        ...existing,
        status: TicketStatus.IN_PROGRESS,
        technicianId: 'tech-1',
      };
      prisma.ticket.update.mockResolvedValue(updated);

      await service.update(
        'tkt-1',
        { status: TicketStatus.IN_PROGRESS },
        'sup-1',
        Role.SUPERVISOR,
      );

      expect(prisma.ticketStatusHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketId: 'tkt-1',
            fromStatus: TicketStatus.NEW,
            toStatus: TicketStatus.IN_PROGRESS,
            changedById: 'sup-1',
          }),
        }),
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'emp-1' }),
      );
    });

    // docs/06-cas-utilisation.md UC-013
    it('persists the resolution note alongside the RESOLVED status', async () => {
      const updated = {
        ...existing,
        status: TicketStatus.RESOLVED,
        resolutionNote: 'Redémarrage du service a résolu le problème.',
      };
      prisma.ticket.update.mockResolvedValue(updated);

      await service.update(
        'tkt-1',
        {
          status: TicketStatus.RESOLVED,
          resolutionNote: 'Redémarrage du service a résolu le problème.',
        },
        'sup-1',
        Role.SUPERVISOR,
      );

      expect(prisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolutionNote: 'Redémarrage du service a résolu le problème.',
          }),
        }),
      );
    });

    // docs/10-architecture-rag.md §11: la transition vers RESOLVED propose
    // un article de connaissance (jamais indexé sans validation humaine).
    it('proposes a knowledge article when the ticket becomes RESOLVED', async () => {
      const updated = { ...existing, status: TicketStatus.RESOLVED };
      prisma.ticket.update.mockResolvedValue(updated);

      await service.update(
        'tkt-1',
        { status: TicketStatus.RESOLVED },
        'sup-1',
        Role.SUPERVISOR,
      );

      expect(knowledgeService.proposeArticleFromTicket).toHaveBeenCalledWith(
        'tkt-1',
      );
    });

    it('does not propose a knowledge article for a non-resolving status change', async () => {
      const updated = { ...existing, status: TicketStatus.IN_PROGRESS };
      prisma.ticket.update.mockResolvedValue(updated);

      await service.update(
        'tkt-1',
        { status: TicketStatus.IN_PROGRESS },
        'sup-1',
        Role.SUPERVISOR,
      );

      expect(knowledgeService.proposeArticleFromTicket).not.toHaveBeenCalled();
    });

    it('notifies and emits realtime event on new technician assignment', async () => {
      const updated = { ...existing, technicianId: 'tech-9' };
      prisma.ticket.update.mockResolvedValue(updated);

      await service.update(
        'tkt-1',
        { technicianId: 'tech-9' },
        'sup-1',
        Role.SUPERVISOR,
      );

      expect(realtimeGateway.emitToUser).toHaveBeenCalledWith(
        'tech-9',
        'ticket.assigned',
        updated,
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'tech-9',
          type: 'TICKET_ASSIGNED',
        }),
      );
    });

    // docs/02-brd.md BR-07: correcting a miscategorized ticket's priority
    // must also correct its SLA deadline, not silently keep the old one.
    describe('SLA recompute on priority change', () => {
      it('recomputes slaDueAt from the original createdAt using the new priority policy', async () => {
        prisma.slaPolicy.findUnique.mockResolvedValue({
          id: 'policy-urgent',
          priorityId: 'prio-urgente',
          resolutionHours: 4,
        });
        prisma.ticket.update.mockResolvedValue({
          ...existing,
          priorityId: 'prio-urgente',
        });

        await service.update(
          'tkt-1',
          { priorityId: 'prio-urgente' },
          'sup-1',
          Role.SUPERVISOR,
        );

        expect(prisma.slaPolicy.findUnique).toHaveBeenCalledWith({
          where: { priorityId: 'prio-urgente' },
        });
        expect(prisma.ticket.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              slaDueAt: new Date(
                existing.createdAt.getTime() + 4 * 60 * 60 * 1000,
              ),
            }),
          }),
        );
      });

      it('sets slaDueAt to null when the new priority has no SLA policy', async () => {
        prisma.slaPolicy.findUnique.mockResolvedValue(null);
        prisma.ticket.update.mockResolvedValue({
          ...existing,
          priorityId: 'prio-no-policy',
        });

        await service.update(
          'tkt-1',
          { priorityId: 'prio-no-policy' },
          'sup-1',
          Role.SUPERVISOR,
        );

        expect(prisma.ticket.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ slaDueAt: null }),
          }),
        );
      });

      it('does not touch slaDueAt or look up a policy when the priority is unchanged', async () => {
        prisma.ticket.update.mockResolvedValue({
          ...existing,
          title: 'Updated title',
        });

        await service.update(
          'tkt-1',
          { title: 'Updated title' },
          'sup-1',
          Role.SUPERVISOR,
        );

        expect(prisma.slaPolicy.findUnique).not.toHaveBeenCalled();
        expect(prisma.ticket.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.not.objectContaining({ slaDueAt: expect.anything() }),
          }),
        );
      });
    });
  });

  // docs/02-brd.md BR-03, docs/05-user-stories.md US-13,
  // docs/06-cas-utilisation.md UC-001 step 9
  describe('create (auto-assignment)', () => {
    const dto = {
      categoryId: 'cat-1',
      priorityId: 'prio-1',
      title: 'Le serveur ne répond plus',
    };

    it('auto-assigns the least-loaded technician in the matching team', async () => {
      prisma.team.findMany.mockResolvedValue([{ id: 'team-1' }]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'tech-busy', displayName: 'Busy', email: 'busy@test.com' },
        { id: 'tech-free', displayName: 'Free', email: 'free@test.com' },
      ]);
      prisma.ticket.groupBy.mockResolvedValue([
        { technicianId: 'tech-busy', _count: { _all: 5 } },
      ]);
      const created = {
        id: 'tkt-1',
        reference: 'TCK-2026-0001',
        technicianId: 'tech-free',
      };
      prisma.ticket.create.mockResolvedValue(created);

      const result = await service.create(dto, 'emp-1');

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ technicianId: 'tech-free' }),
        }),
      );
      expect(realtimeGateway.emitToUser).toHaveBeenCalledWith(
        'tech-free',
        'ticket.created',
        created,
      );
      expect(notificationsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'tech-free',
          type: 'TICKET_ASSIGNED',
        }),
      );
      expect(result).toBe(created);
    });

    it('falls back to the least-loaded generalist when no team matches the category', async () => {
      prisma.team.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'tech-a', displayName: 'A', email: 'a@test.com' },
      ]);
      prisma.ticket.create.mockResolvedValue({
        id: 'tkt-1',
        reference: 'TCK-2026-0001',
        technicianId: 'tech-a',
      });

      await service.create(dto, 'emp-1');

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { role: Role.TECHNICIAN, isActive: true },
        }),
      );
    });

    it('leaves the ticket unassigned when no technician is available at all', async () => {
      prisma.team.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);
      const created = {
        id: 'tkt-1',
        reference: 'TCK-2026-0001',
        technicianId: null,
      };
      prisma.ticket.create.mockResolvedValue(created);

      await service.create(dto, 'emp-1');

      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ technicianId: undefined }),
        }),
      );
      expect(notificationsService.create).not.toHaveBeenCalled();
    });

    it('honors an explicit technicianId override instead of auto-assigning', async () => {
      const created = {
        id: 'tkt-1',
        reference: 'TCK-2026-0001',
        technicianId: 'tech-manual',
      };
      prisma.ticket.create.mockResolvedValue(created);

      await service.create({ ...dto, technicianId: 'tech-manual' }, 'emp-1');

      expect(prisma.team.findMany).not.toHaveBeenCalled();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.ticket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ technicianId: 'tech-manual' }),
        }),
      );
    });

    // generateReference()'s count()+1 scheme isn't atomic under concurrent
    // creates (e.g. parallel e2e test workers hitting the same table) —
    // a collision on the unique reference should be retried, not surfaced
    // as a 500.
    it('retries with a fresh reference when the generated one collides', async () => {
      prisma.team.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.ticket.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      const created = {
        id: 'tkt-1',
        reference: 'TCK-2026-0002',
        technicianId: null,
      };
      prisma.ticket.create
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '7.9.1',
          }),
        )
        .mockResolvedValueOnce(created);

      const result = await service.create(dto, 'emp-1');

      expect(prisma.ticket.create).toHaveBeenCalledTimes(2);
      expect(prisma.ticket.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({ reference: 'TCK-2026-0001' }),
        }),
      );
      expect(prisma.ticket.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: expect.objectContaining({ reference: 'TCK-2026-0002' }),
        }),
      );
      expect(result).toBe(created);
    });
  });

  describe('suggestTechnician', () => {
    it('throws NotFoundException when no technician is available', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        categoryId: 'cat-1',
        statusHistory: [],
      });
      prisma.team.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([]);

      await expect(service.suggestTechnician('tkt-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the least-loaded candidate', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        categoryId: 'cat-1',
        statusHistory: [],
      });
      prisma.team.findMany.mockResolvedValue([]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'tech-a', displayName: 'A', email: 'a@test.com' },
      ]);
      prisma.ticket.groupBy.mockResolvedValue([]);

      const result = await service.suggestTechnician('tkt-1');

      expect(result.id).toBe('tech-a');
    });
  });
});
