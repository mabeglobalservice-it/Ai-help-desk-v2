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
import { AiService } from '../ai/ai.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { TicketsService } from '../tickets/tickets.service';
import {
  ApprovalStatus,
  AutomationRunStatus,
  AutoResolutionStatus,
  Role,
} from '../../generated/prisma/client';

describe('AutomationService', () => {
  let service: AutomationService;
  let prisma: {
    script: { findUnique: jest.Mock; findMany: jest.Mock; create: jest.Mock };
    ticket: { findUnique: jest.Mock };
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
    autoResolution: { create: jest.Mock };
  };
  let notificationsService: { create: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let realtimeGateway: { emitToUser: jest.Mock };
  let aiService: {
    suggestAutomationForTicket: jest.Mock;
    attemptAutoResolution: jest.Mock;
    diagnoseTicket: jest.Mock;
  };
  let knowledgeService: {
    indexScript: jest.Mock;
    proposeArticleFromAutoResolution: jest.Mock;
  };
  let ticketsService: { create: jest.Mock };

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
      script: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn() },
      ticket: { findUnique: jest.fn() },
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
      autoResolution: { create: jest.fn() },
    };
    notificationsService = { create: jest.fn().mockResolvedValue(undefined) };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    realtimeGateway = { emitToUser: jest.fn() };
    aiService = {
      suggestAutomationForTicket: jest.fn(),
      attemptAutoResolution: jest.fn(),
      diagnoseTicket: jest.fn(),
    };
    knowledgeService = {
      indexScript: jest.fn().mockResolvedValue(undefined),
      proposeArticleFromAutoResolution: jest.fn().mockResolvedValue(undefined),
    };
    ticketsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AutomationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuditLogService, useValue: auditLogService },
        { provide: RealtimeGateway, useValue: realtimeGateway },
        { provide: AiService, useValue: aiService },
        { provide: KnowledgeService, useValue: knowledgeService },
        { provide: TicketsService, useValue: ticketsService },
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

  // docs/05-user-stories.md US-28: pre-selects a script + justification
  // from the ticket's own context, never executes or requests anything.
  describe('suggestScriptForTicket', () => {
    it('throws NotFoundException when the ticket does not exist', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);
      prisma.script.findMany.mockResolvedValue([]);

      await expect(service.suggestScriptForTicket('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when AiService finds nothing relevant', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        title: 'Imprimante bloquée',
        summary: 'La file est bloquée',
        category: { name: 'Matériel' },
      });
      prisma.script.findMany.mockResolvedValue([sensitiveScript]);
      aiService.suggestAutomationForTicket.mockResolvedValue(null);

      await expect(service.suggestScriptForTicket('tkt-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the suggested script id, name, and justification', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        title: 'Compte verrouillé après 5 tentatives',
        summary: null,
        category: { name: 'Accès' },
      });
      prisma.script.findMany.mockResolvedValue([sensitiveScript]);
      aiService.suggestAutomationForTicket.mockResolvedValue({
        scriptId: sensitiveScript.id,
        justification: 'Compte verrouillé après 5 tentatives',
        degraded: true,
      });

      const result = await service.suggestScriptForTicket('tkt-1');

      expect(aiService.suggestAutomationForTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Compte verrouillé après 5 tentatives',
          categoryName: 'Accès',
        }),
        [
          expect.objectContaining({
            id: sensitiveScript.id,
            name: sensitiveScript.name,
          }),
        ],
      );
      expect(result).toEqual({
        scriptId: sensitiveScript.id,
        scriptName: sensitiveScript.name,
        justification: 'Compte verrouillé après 5 tentatives',
      });
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

  // docs/06-cas-utilisation.md UC-015 ("Résolution automatique"), RM-03.
  describe('proposeAutoResolution', () => {
    it('returns eligible=false when AiService finds no confident match', async () => {
      prisma.script.findMany.mockResolvedValue([nonSensitiveScript]);
      aiService.attemptAutoResolution.mockResolvedValue(null);

      const result = await service.proposeAutoResolution('Imprimante bloquée');

      expect(aiService.attemptAutoResolution).toHaveBeenCalledWith(
        'Imprimante bloquée',
        [expect.objectContaining({ id: nonSensitiveScript.id })],
      );
      expect(result).toEqual({ eligible: false });
    });

    it('returns the proposal when AiService is confident (>= 95%)', async () => {
      prisma.script.findMany.mockResolvedValue([nonSensitiveScript]);
      aiService.attemptAutoResolution.mockResolvedValue({
        scriptId: nonSensitiveScript.id,
        confidence: 0.97,
        explanation: 'Vidage de cache standard',
      });

      const result = await service.proposeAutoResolution('Imprimante bloquée');

      expect(result).toEqual({
        eligible: true,
        scriptId: nonSensitiveScript.id,
        scriptName: nonSensitiveScript.name,
        confidence: 0.97,
        explanation: 'Vidage de cache standard',
      });
    });
  });

  describe('confirmAutoResolution', () => {
    const confirmDto = {
      description: 'Imprimante bloquée',
      scriptId: nonSensitiveScript.id,
      confidence: 0.97,
    };

    it('throws NotFoundException when the script no longer exists', async () => {
      prisma.script.findUnique.mockResolvedValue(null);

      await expect(
        service.confirmAutoResolution(confirmDto, 'emp-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('executes the script, records a RESOLVED AutoResolution, and proposes a KB article — no ticket created', async () => {
      prisma.script.findUnique.mockResolvedValue(nonSensitiveScript);
      prisma.autoResolution.create.mockResolvedValue({ id: 'autores-1' });

      const result = await service.confirmAutoResolution(confirmDto, 'emp-1');

      expect(prisma.autoResolution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employeeId: 'emp-1',
            scriptId: nonSensitiveScript.id,
            status: AutoResolutionStatus.RESOLVED,
          }),
        }),
      );
      expect(
        knowledgeService.proposeArticleFromAutoResolution,
      ).toHaveBeenCalledWith(
        'autores-1',
        confirmDto.description,
        expect.any(String),
      );
      expect(ticketsService.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: AutoResolutionStatus.RESOLVED,
        outputLog: expect.any(String),
        autoResolutionId: 'autores-1',
      });
    });

    // docs/06-cas-utilisation.md UC-015, RM-03 revérifié à la confirmation :
    // le script proposé n'est plus non sensible depuis la proposition ->
    // repli sur un ticket standard avec le contexte de la tentative.
    it('falls back to creating a standard ticket when the script has since become sensitive', async () => {
      prisma.script.findUnique.mockResolvedValue({
        ...nonSensitiveScript,
        isSensitive: true,
      });
      aiService.diagnoseTicket.mockResolvedValue({
        title: 'Imprimante bloquée',
        categoryId: 'cat-1',
        priorityId: 'prio-1',
        categoryName: 'Matériel',
        priorityName: 'Moyenne',
        degraded: false,
        conversationId: 'conv-1',
      });
      ticketsService.create.mockResolvedValue({ id: 'ticket-1' });
      prisma.autoResolution.create.mockResolvedValue({ id: 'autores-2' });

      const result = await service.confirmAutoResolution(confirmDto, 'emp-1');

      expect(ticketsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'cat-1', priorityId: 'prio-1' }),
        'emp-1',
      );
      expect(prisma.autoResolution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: AutoResolutionStatus.FAILED_FALLBACK,
            fallbackTicketId: 'ticket-1',
          }),
        }),
      );
      expect(
        knowledgeService.proposeArticleFromAutoResolution,
      ).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: AutoResolutionStatus.FAILED_FALLBACK,
        ticketId: 'ticket-1',
        autoResolutionId: 'autores-2',
      });
    });
  });
});
