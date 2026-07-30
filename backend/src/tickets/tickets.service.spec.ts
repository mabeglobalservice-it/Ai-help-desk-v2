import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { Role, TicketStatus } from '../../generated/prisma/client';

describe('TicketsService', () => {
  let service: TicketsService;
  let prisma: {
    ticket: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
    };
    ticketStatusHistory: { create: jest.Mock };
    slaPolicy: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let realtimeGateway: { emitToUser: jest.Mock; emitToRole: jest.Mock };

  beforeEach(async () => {
    prisma = {
      ticket: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      ticketStatusHistory: { create: jest.fn() },
      slaPolicy: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    realtimeGateway = { emitToUser: jest.fn(), emitToRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: RealtimeGateway, useValue: realtimeGateway },
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
  });
});
