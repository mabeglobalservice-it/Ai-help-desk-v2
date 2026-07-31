import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SlaService } from './sla.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TicketStatus } from '../../generated/prisma/client';

describe('SlaService', () => {
  let service: SlaService;
  let prisma: {
    ticket: { findMany: jest.Mock; update: jest.Mock };
    user: { findMany: jest.Mock };
    ticketStatusHistory: { create: jest.Mock };
    slaPolicy: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let notificationsService: { create: jest.Mock };
  let realtimeGateway: { emitToUser: jest.Mock };
  let auditLogService: { record: jest.Mock };

  const breachedNewTicket = {
    id: 'tkt-1',
    reference: 'TCK-2026-0001',
    status: TicketStatus.NEW,
    employeeId: 'emp-1',
    technicianId: null,
  };

  const breachedInProgressTicket = {
    id: 'tkt-2',
    reference: 'TCK-2026-0002',
    status: TicketStatus.IN_PROGRESS,
    employeeId: 'emp-2',
    technicianId: 'tech-1',
  };

  beforeEach(async () => {
    prisma = {
      ticket: { findMany: jest.fn(), update: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'sup-1' }]) },
      ticketStatusHistory: { create: jest.fn() },
      slaPolicy: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    realtimeGateway = { emitToUser: jest.fn() };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: RealtimeGateway, useValue: realtimeGateway },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(SlaService);
  });

  it('does nothing when no ticket has breached its SLA', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);

    await service.checkAndNotifyBreaches();

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
  });

  it('only queries tickets that are not RESOLVED and not already notified', async () => {
    prisma.ticket.findMany.mockResolvedValue([]);

    await service.checkAndNotifyBreaches();

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slaBreachNotifiedAt: null,
          status: { not: TicketStatus.RESOLVED },
        }),
      }),
    );
  });

  it('auto-escalates a breached NEW ticket and notifies supervisors/admins', async () => {
    prisma.ticket.findMany.mockResolvedValue([breachedNewTicket]);
    prisma.user.findMany.mockResolvedValue([{ id: 'sup-1' }, { id: 'adm-1' }]);

    await service.checkAndNotifyBreaches();

    // escalateTicket runs the status update + history entry in one transaction
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tkt-1' },
        data: { status: TicketStatus.ESCALATED },
      }),
    );
    expect(prisma.ticketStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: 'tkt-1',
          fromStatus: TicketStatus.NEW,
          toStatus: TicketStatus.ESCALATED,
        }),
      }),
    );

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'sup-1',
        type: 'SLA_BREACHED',
        message: expect.stringContaining('escaladé automatiquement'),
      }),
    );
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'adm-1' }),
    );

    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tkt-1' },
        data: { slaBreachNotifiedAt: expect.any(Date) },
      }),
    );

    // the employee (and technician, if any) also get the escalation notice
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'emp-1', type: 'STATUS_CHANGED' }),
    );
  });

  it('does not escalate a breached ticket that is already IN_PROGRESS, only notifies', async () => {
    prisma.ticket.findMany.mockResolvedValue([breachedInProgressTicket]);

    await service.checkAndNotifyBreaches();

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'sup-1',
        type: 'SLA_BREACHED',
        message: expect.not.stringContaining('escaladé automatiquement'),
      }),
    );
  });

  it('still marks the ticket as notified even if escalation fails (best-effort)', async () => {
    prisma.ticket.findMany.mockResolvedValue([breachedNewTicket]);
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));

    await service.checkAndNotifyBreaches();

    expect(prisma.ticket.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tkt-1' },
        data: { slaBreachNotifiedAt: expect.any(Date) },
      }),
    );
  });

  it('does not throw if notifying breach recipients fails (best-effort, retried next run)', async () => {
    prisma.ticket.findMany.mockResolvedValue([breachedInProgressTicket]);
    notificationsService.create.mockRejectedValue(new Error('smtp down'));

    await expect(service.checkAndNotifyBreaches()).resolves.toBeUndefined();
    expect(prisma.ticket.update).not.toHaveBeenCalled();
  });

  // docs/06-cas-utilisation.md UC-020
  describe('updatePolicy', () => {
    it('throws NotFoundException when the priority has no SLA policy', async () => {
      prisma.slaPolicy.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePolicy(
          'missing-priority',
          { resolutionHours: 4 },
          'sup-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates the resolution hours and records an audit log entry', async () => {
      prisma.slaPolicy.findUnique.mockResolvedValue({
        id: 'policy-1',
        priorityId: 'prio-urgent',
        resolutionHours: 4,
      });
      prisma.slaPolicy.update.mockResolvedValue({
        id: 'policy-1',
        priorityId: 'prio-urgent',
        resolutionHours: 1,
      });

      const result = await service.updatePolicy(
        'prio-urgent',
        { resolutionHours: 1 },
        'sup-1',
      );

      expect(prisma.slaPolicy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { priorityId: 'prio-urgent' },
          data: { resolutionHours: 1 },
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'sup-1',
          action: 'SLA_POLICY_UPDATED',
          targetType: 'SlaPolicy',
          targetId: 'policy-1',
          beforeState: { resolutionHours: 4 },
          afterState: { resolutionHours: 1 },
        }),
      );
      expect(result.resolutionHours).toBe(1);
    });
  });
});
