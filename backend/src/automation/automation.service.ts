import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AiService } from '../ai/ai.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { TicketsService } from '../tickets/tickets.service';
import {
  ActorType,
  ApprovalStatus,
  AutomationRunStatus,
  AutoResolutionStatus,
  NotificationType,
  Role,
} from '../../generated/prisma/client';
import { CreateScriptDto } from './dto/create-script.dto';
import { CreateAutomationRunDto } from './dto/create-automation-run.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { ConfirmAutoResolutionDto } from './dto/confirm-auto-resolution.dto';

interface Requester {
  userId: string;
  role: Role;
}

const RUN_INCLUDE = {
  script: true,
  ticket: { select: { id: true, reference: true, title: true } },
  requestedBy: { select: { id: true, displayName: true, email: true } },
  executedBy: { select: { id: true, displayName: true, email: true } },
  approval: true,
} as const;

const APPROVAL_INCLUDE = {
  automationRun: { include: RUN_INCLUDE },
} as const;

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLogService: AuditLogService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly aiService: AiService,
    private readonly knowledgeService: KnowledgeService,
    private readonly ticketsService: TicketsService,
  ) {}

  findAllScripts() {
    return this.prisma.script.findMany({ orderBy: { name: 'asc' } });
  }

  // docs/05-user-stories.md US-28: prepares (pre-selects) a script and
  // justification from the ticket's own context so a technician isn't
  // typing it from scratch — never executes or requests anything by
  // itself; the technician still reviews and submits via requestRun().
  async suggestScriptForTicket(ticketId: string) {
    const [ticket, scripts] = await Promise.all([
      this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { category: true },
      }),
      this.prisma.script.findMany(),
    ]);

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} introuvable`);
    }

    const suggestion = await this.aiService.suggestAutomationForTicket(
      {
        title: ticket.title,
        summary: ticket.summary,
        categoryName: ticket.category.name,
      },
      scripts.map((script) => ({
        id: script.id,
        name: script.name,
        content: script.content,
      })),
    );

    if (!suggestion) {
      throw new NotFoundException('Aucune action à suggérer pour ce ticket');
    }

    const script = scripts.find((s) => s.id === suggestion.scriptId);
    return {
      scriptId: suggestion.scriptId,
      scriptName: script?.name,
      justification: suggestion.justification,
    };
  }

  async createScript(dto: CreateScriptDto, adminId: string) {
    const script = await this.prisma.script.create({
      data: {
        name: dto.name,
        language: dto.language,
        content: dto.content,
        isSensitive: dto.isSensitive ?? true,
      },
    });

    await this.auditLogService.record({
      actorId: adminId,
      action: 'AUTOMATION_SCRIPT_CREATED',
      targetType: 'Script',
      targetId: script.id,
      afterState: { name: script.name, isSensitive: script.isSensitive },
    });

    // docs/10-architecture-rag.md §13 niveau 4 ("automatisation") : un
    // script catalogué par un Admin devient consultable via la recherche
    // multi-niveaux. Best-effort : un échec d'indexation ne doit jamais
    // faire échouer la création du script elle-même.
    try {
      await this.knowledgeService.indexScript(script);
    } catch (error) {
      console.error('Failed to index automation script for RAG search', error);
    }

    return script;
  }

  // docs/09-architecture-agents-ia.md §3.5, RM-01: la sensibilité vient
  // exclusivement de scripts.is_sensitive, jamais d'un champ envoyé par le
  // client — c'est ce qui decide si une approbation humaine est requise.
  async requestRun(dto: CreateAutomationRunDto, requester: Requester) {
    const script = await this.prisma.script.findUnique({
      where: { id: dto.scriptId },
    });
    if (!script) {
      throw new NotFoundException(`Script ${dto.scriptId} introuvable`);
    }

    const run = await this.prisma.automationRun.create({
      data: {
        scriptId: script.id,
        ticketId: dto.ticketId,
        ciId: dto.ciId,
        requestedById: requester.userId,
        justification: dto.justification,
        status: script.isSensitive
          ? AutomationRunStatus.PENDING_APPROVAL
          : AutomationRunStatus.RUNNING,
      },
      include: RUN_INCLUDE,
    });

    await this.auditLogService.record({
      actorId: requester.userId,
      action: 'AUTOMATION_RUN_REQUESTED',
      targetType: 'AutomationRun',
      targetId: run.id,
      afterState: { scriptId: script.id, isSensitive: script.isSensitive },
      reason: dto.justification,
    });

    if (!script.isSensitive) {
      return this.executeRun(run.id, null);
    }

    const approval = await this.prisma.approval.create({
      data: { automationRunId: run.id },
    });

    await this.notifyEligibleApprovers(run, script, approval.id);

    return this.prisma.automationRun.findUniqueOrThrow({
      where: { id: run.id },
      include: RUN_INCLUDE,
    });
  }

  private async notifyEligibleApprovers(
    run: { id: string; ticketId: string | null; justification: string },
    script: { name: string },
    approvalId: string,
  ) {
    const approvers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        OR: [
          { role: { in: [Role.SUPERVISOR, Role.ADMIN] } },
          { role: Role.TECHNICIAN, canApproveAutomations: true },
        ],
      },
      select: { id: true },
    });

    const message = `Action sensible en attente d'approbation : « ${script.name} »`;
    const payload = {
      approvalId,
      automationRunId: run.id,
      ticketId: run.ticketId,
    };

    for (const approver of approvers) {
      this.realtimeGateway.emitToUser(
        approver.id,
        'approval.requested',
        payload,
      );
      try {
        await this.notificationsService.create({
          recipientId: approver.id,
          type: NotificationType.APPROVAL_REQUESTED,
          message,
          ticketId: run.ticketId ?? undefined,
        });
      } catch (error) {
        // best-effort: a notification failure shouldn't block the request
        console.error('Failed to notify automation approver', error);
      }
    }
  }

  async findRunById(id: string, requester: Requester) {
    const run = await this.prisma.automationRun.findUnique({
      where: { id },
      include: RUN_INCLUDE,
    });

    if (!run) {
      throw new NotFoundException(`Exécution ${id} introuvable`);
    }

    if (
      requester.role === Role.TECHNICIAN &&
      run.requestedById !== requester.userId
    ) {
      throw new ForbiddenException(
        "Vous n'êtes pas à l'origine de cette demande",
      );
    }

    return run;
  }

  // docs/06-cas-utilisation.md UC-022, docs/11-documentation-api.md §8:
  // reservé au Superviseur (toujours habilité) et au TECHNICIAN explicitement
  // habilité par un Administrateur (User.canApproveAutomations).
  async findPendingApprovals(requester: Requester) {
    await this.assertCanApprove(requester);

    return this.prisma.approval.findMany({
      where: { status: ApprovalStatus.PENDING },
      include: APPROVAL_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async decideApproval(
    id: string,
    dto: DecideApprovalDto,
    requester: Requester,
  ) {
    if (
      dto.decision !== ApprovalStatus.APPROVED &&
      dto.decision !== ApprovalStatus.REJECTED
    ) {
      throw new BadRequestException(
        'La décision doit être APPROVED ou REJECTED',
      );
    }

    await this.assertCanApprove(requester);

    const approval = await this.prisma.approval.findUnique({
      where: { id },
      include: APPROVAL_INCLUDE,
    });
    if (!approval) {
      throw new NotFoundException(`Approbation ${id} introuvable`);
    }
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('Cette approbation a déjà été traitée');
    }

    // docs/12-maquettes-ui-ux.md §4.4: évite le biais d'automatisation en
    // interdisant qu'un demandeur valide sa propre demande.
    if (approval.automationRun.requestedById === requester.userId) {
      throw new ForbiddenException(
        'Vous ne pouvez pas approuver votre propre demande',
      );
    }

    await this.prisma.approval.update({
      where: { id },
      data: {
        status: dto.decision,
        approvedById: requester.userId,
        decidedAt: new Date(),
      },
    });

    await this.auditLogService.record({
      actorId: requester.userId,
      action:
        dto.decision === ApprovalStatus.APPROVED
          ? 'AUTOMATION_APPROVED'
          : 'AUTOMATION_REJECTED',
      targetType: 'AutomationRun',
      targetId: approval.automationRunId,
      reason: dto.note,
    });

    const run =
      dto.decision === ApprovalStatus.APPROVED
        ? await this.executeRun(approval.automationRunId, requester.userId)
        : await this.prisma.automationRun.update({
            where: { id: approval.automationRunId },
            data: { status: AutomationRunStatus.REJECTED },
            include: RUN_INCLUDE,
          });

    try {
      await this.notificationsService.create({
        recipientId: approval.automationRun.requestedById,
        type: NotificationType.AUTOMATION_DECIDED,
        message:
          dto.decision === ApprovalStatus.APPROVED
            ? `Votre demande d'automatisation « ${approval.automationRun.script.name} » a été approuvée`
            : `Votre demande d'automatisation « ${approval.automationRun.script.name} » a été rejetée`,
        ticketId: approval.automationRun.ticketId ?? undefined,
      });
    } catch (error) {
      console.error('Failed to notify automation requester', error);
    }

    return run;
  }

  private async assertCanApprove(requester: Requester) {
    if (requester.role === Role.SUPERVISOR || requester.role === Role.ADMIN) {
      return;
    }

    if (requester.role === Role.TECHNICIAN) {
      const user = await this.prisma.user.findUnique({
        where: { id: requester.userId },
        select: { canApproveAutomations: true },
      });
      if (user?.canApproveAutomations) {
        return;
      }
    }

    throw new ForbiddenException(
      "Vous n'êtes pas habilité à approuver les actions sensibles",
    );
  }

  // Exécution simulée : ce projet ne dispose d'aucune intégration réelle
  // Active Directory / Microsoft Graph / Intune (docs/06-cas-utilisation.md
  // UC-030 est un module V5 distinct, non implémenté). L'exécution se limite
  // donc à un changement d'état et une entrée de journal, sans appel système
  // réel — cohérent avec le reste de l'application, qui ne synchronise pas
  // non plus les comptes depuis un annuaire.
  private async executeRun(runId: string, executedById: string | null) {
    const started = await this.prisma.automationRun.update({
      where: { id: runId },
      data: { status: AutomationRunStatus.RUNNING, startedAt: new Date() },
      include: RUN_INCLUDE,
    });

    const finished = await this.prisma.automationRun.update({
      where: { id: runId },
      data: {
        status: AutomationRunStatus.SUCCESS,
        executedById,
        finishedAt: new Date(),
        outputLog: `Exécution simulée : script "${started.script.name}" (${started.script.language}) complété avec succès.`,
      },
      include: RUN_INCLUDE,
    });

    await this.auditLogService.record({
      actorId: executedById,
      actorType: executedById ? ActorType.USER : ActorType.SYSTEM,
      action: 'AUTOMATION_EXECUTED',
      targetType: 'AutomationRun',
      targetId: runId,
      afterState: { status: finished.status },
    });

    return finished;
  }

  // docs/06-cas-utilisation.md UC-015 étapes 1-3 : propose (ne décide et
  // n'exécute rien) une résolution automatique, uniquement à partir de
  // scripts déjà catalogués non sensibles.
  async proposeAutoResolution(description: string) {
    const nonSensitiveScripts = await this.prisma.script.findMany({
      where: { isSensitive: false },
    });

    const suggestion = await this.aiService.attemptAutoResolution(
      description,
      nonSensitiveScripts.map((script) => ({
        id: script.id,
        name: script.name,
        content: script.content,
      })),
    );

    if (!suggestion) {
      return { eligible: false as const };
    }

    const script = nonSensitiveScripts.find(
      (s) => s.id === suggestion.scriptId,
    );
    if (!script) {
      return { eligible: false as const };
    }

    return {
      eligible: true as const,
      scriptId: script.id,
      scriptName: script.name,
      confidence: suggestion.confidence,
      explanation: suggestion.explanation,
    };
  }

  // docs/06-cas-utilisation.md UC-015 étapes 4-8. RM-03 est revérifié ici
  // (le script est-il ENCORE non sensible ?), jamais seulement au moment de
  // la proposition : c'est ce qui peut faire basculer sur le cas d'échec
  // (étape 5 du scénario d'erreur) plutôt que le corps de la requête.
  async confirmAutoResolution(
    dto: ConfirmAutoResolutionDto,
    employeeId: string,
  ) {
    const script = await this.prisma.script.findUnique({
      where: { id: dto.scriptId },
    });
    if (!script) {
      throw new NotFoundException(`Script ${dto.scriptId} introuvable`);
    }

    if (script.isSensitive) {
      return this.fallbackToTicket(dto, employeeId, script.name);
    }

    const outputLog = `Résolution automatique : script "${script.name}" (${script.language}) exécuté avec succès.`;

    const autoResolution = await this.prisma.autoResolution.create({
      data: {
        employeeId,
        description: dto.description,
        scriptId: script.id,
        confidenceScore: dto.confidence,
        status: AutoResolutionStatus.RESOLVED,
        outputLog,
      },
    });

    await this.auditLogService.record({
      actorId: employeeId,
      actorType: ActorType.SYSTEM,
      action: 'AUTO_RESOLUTION_EXECUTED',
      targetType: 'AutoResolution',
      targetId: autoResolution.id,
      afterState: { scriptId: script.id, confidence: dto.confidence },
    });

    // docs UC-015 étape 8, doc 10 §11 : jamais indexé sans validation
    // humaine, même circuit que pour un ticket résolu (proposeArticleFromTicket).
    try {
      await this.knowledgeService.proposeArticleFromAutoResolution(
        autoResolution.id,
        dto.description,
        outputLog,
      );
    } catch (error) {
      console.error(
        'Failed to propose knowledge article for auto-resolution',
        error,
      );
    }

    return {
      status: AutoResolutionStatus.RESOLVED,
      outputLog,
      autoResolutionId: autoResolution.id,
    };
  }

  // docs/06-cas-utilisation.md UC-015, cas d'erreur "L'action échoue à
  // l'exécution" : bascule sur la création d'un ticket standard (UC-001
  // étape 7) avec le contexte de la tentative automatique inclus.
  private async fallbackToTicket(
    dto: ConfirmAutoResolutionDto,
    employeeId: string,
    scriptName: string,
  ) {
    const diagnosis = await this.aiService.diagnoseTicket(
      dto.description,
      employeeId,
    );

    const ticket = await this.ticketsService.create(
      {
        categoryId: diagnosis.categoryId,
        priorityId: diagnosis.priorityId,
        title: diagnosis.title,
        summary: `${dto.description}\n\n(Tentative de résolution automatique échouée : le script "${scriptName}" n'est plus classé non sensible.)`,
      },
      employeeId,
    );

    const autoResolution = await this.prisma.autoResolution.create({
      data: {
        employeeId,
        description: dto.description,
        scriptId: dto.scriptId,
        confidenceScore: dto.confidence,
        status: AutoResolutionStatus.FAILED_FALLBACK,
        outputLog: `Échec : le script "${scriptName}" est désormais classé sensible et nécessite une approbation humaine (RM-03).`,
        fallbackTicketId: ticket.id,
      },
    });

    await this.auditLogService.record({
      actorId: employeeId,
      actorType: ActorType.SYSTEM,
      action: 'AUTO_RESOLUTION_FAILED_FALLBACK',
      targetType: 'AutoResolution',
      targetId: autoResolution.id,
      afterState: { fallbackTicketId: ticket.id },
    });

    return {
      status: AutoResolutionStatus.FAILED_FALLBACK,
      ticketId: ticket.id,
      autoResolutionId: autoResolution.id,
    };
  }
}
