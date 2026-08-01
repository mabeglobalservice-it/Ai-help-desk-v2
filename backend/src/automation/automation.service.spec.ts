import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AutomationService } from './automation.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  ApprovalStatus,
  AutomationRunStatus,
  Role,
} from '../../generated/prisma/client';

describe('AutomationService', () => {
  let service: AutomationService;
  let prisma: {
    script: { findUnique: jest.Mock; create: jest.Mock };
    automationRun: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    approval: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
    };
    user: { findMany: jest.Mock; findUnique: jest.Mock };
  };
  let notificationsService: { create: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let realtimeGateway: { emitToUser: jest.Mock };

  const nonSensitiveScript = {
    id: 'script-1',
    name: 'Vider le cache',
    language: 'BASH',
    isSensitive: false,
  };
  const sensitiveScript = {
    id: 'script-2',
    name: 'Réinitialiser le mot de passe',
    language: 'POWERSHELL',
    isSensitive: true,
  };

  const technician: { userId: string; role: Role } = {
    userId: 'tech-1',
    role: Role.TECHNICIAN,
  };
  const supervisor: { userId: string; role: Role } = {
    userId: 'sup-1',
    role: Role.SUPERVISOR,
  };

  beforeEach(async () => {
    prisma = {
      script: { findUnique: jest.fn(), create: jest.fn() },
      automationRun: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      approval: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      user: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    realtimeGateway = { emitToUser: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: RealtimeGateway, useValue: realtimeGateway },
      ],
    }).compile();

    service = module.get(AutomationService);
  });

  describe('requestRun', () => {
    it('throws NotFoundException when the script does not exist', async () => {
      prisma.script.findUnique.mockResolvedValue(null);

      await expect(
        service.requestRun(
          { scriptId: 'missing', justification: 'test' },
          technician,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('executes a non-sensitive script immediately, without creating an approval', async () => {
      prisma.script.findUnique.mockResolvedValue(nonSensitiveScript);
      prisma.automationRun.create.mockResolvedValue({
        id: 'run-1',
        ticketId: 'ticket-1',
        justification: 'test',
      });
      prisma.automationRun.update
        .mockResolvedValueOnce({ script: nonSensitiveScript })
        .mockResolvedValueOnce({
          id: 'run-1',
          status: AutomationRunStatus.SUCCESS,
          executedById: null,
          script: nonSensitiveScript,
        });

      const result = await service.requestRun(
        { scriptId: 'script-1', justification: 'test' },
        technician,
      );

      expect(prisma.automationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutomationRunStatus.RUNNING,
          }),
        }),
      );
      expect(prisma.approval.create).not.toHaveBeenCalled();
      expect(result.status).toBe(AutomationRunStatus.SUCCESS);
      expect(result.executedById).toBeNull();
    });

    it('creates a pending approval and notifies eligible approvers for a sensitive script', async () => {
      prisma.script.findUnique.mockResolvedValue(sensitiveScript);
      prisma.automationRun.create.mockResolvedValue({
        id: 'run-2',
        ticketId: 'ticket-2',
        justification: 'Compte verrouillé',
      });
      prisma.approval.create.mockResolvedValue({ id: 'approval-1' });
      prisma.user.findMany.mockResolvedValue([
        { id: 'sup-1' },
        { id: 'habilite-tech-1' },
      ]);
      prisma.automationRun.findUniqueOrThrow.mockResolvedValue({
        id: 'run-2',
        status: AutomationRunStatus.PENDING_APPROVAL,
      });

      const result = await service.requestRun(
        { scriptId: 'script-2', justification: 'Compte verrouillé' },
        technician,
      );

      expect(prisma.automationRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutomationRunStatus.PENDING_APPROVAL,
          }),
        }),
      );
      expect(prisma.approval.create).toHaveBeenCalledWith({
        data: { automationRunId: 'run-2' },
      });
      expect(realtimeGateway.emitToUser).toHaveBeenCalledWith(
        'sup-1',
        'approval.requested',
        expect.anything(),
      );
      expect(realtimeGateway.emitToUser).toHaveBeenCalledWith(
        'habilite-tech-1',
        'approval.requested',
        expect.anything(),
      );
      expect(notificationsService.create).toHaveBeenCalledTimes(2);
      expect(result.status).toBe(AutomationRunStatus.PENDING_APPROVAL);
    });
  });

  describe('findRunById', () => {
    it('throws NotFoundException when the run does not exist', async () => {
      prisma.automationRun.findUnique.mockResolvedValue(null);

      await expect(service.findRunById('missing', technician)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('forbids a technician from viewing a run they did not request', async () => {
      prisma.automationRun.findUnique.mockResolvedValue({
        id: 'run-1',
        requestedById: 'someone-else',
      });

      await expect(service.findRunById('run-1', technician)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows a supervisor to view any run', async () => {
      prisma.automationRun.findUnique.mockResolvedValue({
        id: 'run-1',
        requestedById: 'someone-else',
      });

      await expect(service.findRunById('run-1', supervisor)).resolves.toEqual(
        expect.objectContaining({ id: 'run-1' }),
      );
    });
  });

  describe('findPendingApprovals', () => {
    it('forbids a technician without canApproveAutomations', async () => {
      prisma.user.findUnique.mockResolvedValue({
        canApproveAutomations: false,
      });

      await expect(service.findPendingApprovals(technician)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows a technician with canApproveAutomations', async () => {
      prisma.user.findUnique.mockResolvedValue({
        canApproveAutomations: true,
      });
      prisma.approval.findMany.mockResolvedValue([{ id: 'approval-1' }]);

      const result = await service.findPendingApprovals(technician);

      expect(result).toHaveLength(1);
    });

    it('always allows a supervisor, without checking the flag', async () => {
      prisma.approval.findMany.mockResolvedValue([]);

      await service.findPendingApprovals(supervisor);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('decideApproval', () => {
    const pendingApproval = {
      id: 'approval-1',
      status: ApprovalStatus.PENDING,
      automationRunId: 'run-1',
      automationRun: {
        id: 'run-1',
        requestedById: 'tech-1',
        ticketId: null,
        script: { name: 'Réinitialiser le mot de passe' },
      },
    };

    it('rejects a decision value other than APPROVED/REJECTED', async () => {
      await expect(
        service.decideApproval(
          'approval-1',
          { decision: ApprovalStatus.PENDING },
          supervisor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the approval does not exist', async () => {
      prisma.approval.findUnique.mockResolvedValue(null);

      await expect(
        service.decideApproval(
          'missing',
          { decision: ApprovalStatus.APPROVED },
          supervisor,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects deciding an approval that was already processed', async () => {
      prisma.approval.findUnique.mockResolvedValue({
        ...pendingApproval,
        status: ApprovalStatus.APPROVED,
      });

      await expect(
        service.decideApproval(
          'approval-1',
          { decision: ApprovalStatus.APPROVED },
          supervisor,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    // docs/12-maquettes-ui-ux.md §4.4: evite le biais d'automatisation.
    it('forbids the requester from approving their own request', async () => {
      prisma.approval.findUnique.mockResolvedValue(pendingApproval);

      await expect(
        service.decideApproval(
          'approval-1',
          { decision: ApprovalStatus.APPROVED },
          technician, // technician.userId === automationRun.requestedById
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('forbids a non-habilité technician from deciding', async () => {
      prisma.user.findUnique.mockResolvedValue({
        canApproveAutomations: false,
      });

      await expect(
        service.decideApproval(
          'approval-1',
          { decision: ApprovalStatus.APPROVED },
          { userId: 'other-tech', role: Role.TECHNICIAN },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('executes the run and records the approver on approval', async () => {
      prisma.approval.findUnique.mockResolvedValue(pendingApproval);
      prisma.approval.update.mockResolvedValue({});
      prisma.automationRun.update
        .mockResolvedValueOnce({ script: pendingApproval.automationRun.script })
        .mockResolvedValueOnce({
          id: 'run-1',
          status: AutomationRunStatus.SUCCESS,
          executedById: 'sup-1',
        });

      const result = await service.decideApproval(
        'approval-1',
        { decision: ApprovalStatus.APPROVED },
        supervisor,
      );

      expect(prisma.approval.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ApprovalStatus.APPROVED,
            approvedById: 'sup-1',
          }),
        }),
      );
      expect(result.status).toBe(AutomationRunStatus.SUCCESS);
      expect(result.executedById).toBe('sup-1');
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AUTOMATION_APPROVED' }),
      );
    });

    it('marks the run REJECTED without executing it on rejection', async () => {
      prisma.approval.findUnique.mockResolvedValue(pendingApproval);
      prisma.approval.update.mockResolvedValue({});
      prisma.automationRun.update.mockResolvedValue({
        id: 'run-1',
        status: AutomationRunStatus.REJECTED,
      });

      const result = await service.decideApproval(
        'approval-1',
        { decision: ApprovalStatus.REJECTED, note: 'Cible incorrecte' },
        supervisor,
      );

      expect(prisma.automationRun.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: AutomationRunStatus.REJECTED },
        }),
      );
      expect(result.status).toBe(AutomationRunStatus.REJECTED);
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'AUTOMATION_REJECTED',
          reason: 'Cible incorrecte',
        }),
      );
    });
  });
});
