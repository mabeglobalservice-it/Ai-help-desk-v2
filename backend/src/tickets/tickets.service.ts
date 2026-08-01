import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KnowledgeService } from '../knowledge/knowledge.service';
import {
  NotificationType,
  Prisma,
  Role,
  TicketStatus,
} from '../../generated/prisma/client';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';
import { RateTicketDto } from './dto/rate-ticket.dto';

const USER_SAFE_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
} as const;

const TICKET_INCLUDE = {
  employee: { select: USER_SAFE_SELECT },
  technician: { select: USER_SAFE_SELECT },
  category: true,
  priority: true,
  ci: { include: { ciType: true } },
} as const;

const STATUS_LABELS: Record<TicketStatus, string> = {
  NEW: 'Nouveau',
  IN_PROGRESS: 'En cours',
  RESOLVED: 'Résolu',
  ESCALATED: 'Escaladé',
};

const OPEN_STATUSES = [
  TicketStatus.NEW,
  TicketStatus.IN_PROGRESS,
  TicketStatus.ESCALATED,
];

interface Requester {
  userId: string;
  role: Role;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly knowledgeService: KnowledgeService,
  ) {}

  private async generateReference(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.ticket.count();
    const sequence = String(count + 1).padStart(4, '0');
    return `TCK-${year}-${sequence}`;
  }

  // generateReference()'s count()+1 scheme isn't atomic: two concurrent
  // creates can compute the same reference and collide on the unique
  // constraint. Rather than a heavier atomic-counter migration, retry with a
  // freshly generated reference a few times — collisions are rare in
  // practice (they mostly showed up here under parallel e2e test workers
  // hitting the same table at once).
  private async createTicketRecord(
    reference: string,
    data: Omit<Prisma.TicketUncheckedCreateInput, 'reference'>,
    attempt = 0,
  ): Promise<Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>> {
    try {
      return await this.prisma.ticket.create({
        data: { ...data, reference },
        include: TICKET_INCLUDE,
      });
    } catch (error) {
      if (
        attempt < 3 &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.createTicketRecord(
          await this.generateReference(),
          data,
          attempt + 1,
        );
      }
      throw error;
    }
  }

  // employeeId comes from the authenticated requester (req.user), never from
  // the request body — otherwise any EMPLOYEE could create a ticket in
  // someone else's name.
  //
  // docs/02-brd.md BR-03, docs/05-user-stories.md US-13, docs/06-cas-
  // utilisation.md UC-001 step 9: the ticket is auto-assigned to the
  // least-loaded technician in the matching specialty (falling back to the
  // least-loaded generalist if none) at creation time, without requiring a
  // supervisor to manually trigger it. A caller-supplied technicianId (e.g.
  // a future admin bulk-import) is honored as an explicit override instead.
  async create(dto: CreateTicketDto, employeeId: string) {
    const [reference, slaPolicy, suggested] = await Promise.all([
      this.generateReference(),
      this.prisma.slaPolicy.findUnique({
        where: { priorityId: dto.priorityId },
      }),
      dto.technicianId
        ? Promise.resolve(null)
        : this.findLeastLoadedTechnician(dto.categoryId),
    ]);

    const slaDueAt = slaPolicy
      ? new Date(Date.now() + slaPolicy.resolutionHours * 60 * 60 * 1000)
      : null;
    const technicianId = dto.technicianId ?? suggested?.id;

    const ticket = await this.createTicketRecord(reference, {
      employeeId,
      categoryId: dto.categoryId,
      priorityId: dto.priorityId,
      title: dto.title,
      summary: dto.summary,
      technicianId,
      ciId: dto.ciId,
      slaDueAt,
    });

    // docs/11-documentation-api.md §13: ticket.created est reçu par le
    // technicien concerné (s'il y en a un dès la création) et les
    // superviseurs/admins.
    this.realtimeGateway.emitToRole(Role.SUPERVISOR, 'ticket.created', ticket);
    this.realtimeGateway.emitToRole(Role.ADMIN, 'ticket.created', ticket);

    if (ticket.technicianId) {
      this.realtimeGateway.emitToUser(
        ticket.technicianId,
        'ticket.created',
        ticket,
      );
      await this.createAssignmentNotification(ticket, ticket.technicianId);
    }

    return ticket;
  }

  // docs/06-cas-utilisation.md RM-04: un employe ne voit que ses propres
  // tickets, un technicien ne voit que ceux qui lui sont assignes, seuls
  // superviseur/admin ont une vue sur l'ensemble des tickets.
  async findAll(query: FindTicketsQueryDto, requester: Requester) {
    return this.prisma.ticket.findMany({
      where: {
        status: query.status,
        categoryId: query.categoryId,
        priorityId: query.priorityId,
        technicianId:
          requester.role === Role.TECHNICIAN
            ? requester.userId
            : query.technicianId,
        employeeId:
          requester.role === Role.EMPLOYEE ? requester.userId : undefined,
      },
      include: TICKET_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  // `requester` is only passed by callers that need RM-04 ownership
  // enforcement (the GET/PATCH controller routes); internal lookups (e.g.
  // suggestTechnician, rate's own explicit ownership check) omit it and get
  // the ticket unconditionally.
  async findOne(id: string, requester?: Requester) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...TICKET_INCLUDE,
        statusHistory: {
          orderBy: { changedAt: 'desc' },
          include: { changedBy: { select: USER_SAFE_SELECT } },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} introuvable`);
    }

    if (requester) this.assertTicketVisible(ticket, requester);

    return ticket;
  }

  private assertTicketVisible(
    ticket: { employeeId: string; technicianId: string | null },
    requester: Requester,
  ) {
    if (
      requester.role === Role.EMPLOYEE &&
      ticket.employeeId !== requester.userId
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce ticket");
    }
    if (
      requester.role === Role.TECHNICIAN &&
      ticket.technicianId !== requester.userId
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce ticket");
    }
  }

  // Manual "suggérer" button (SUPERVISOR/ADMIN): same ranking as the
  // automatic assignment in create(), surfaced as an explicit error when
  // nobody is available instead of silently leaving the ticket unassigned.
  async suggestTechnician(id: string) {
    const ticket = await this.findOne(id);
    const candidate = await this.findLeastLoadedTechnician(ticket.categoryId);

    if (!candidate) {
      throw new NotFoundException(
        'Aucun technicien disponible pour suggérer une assignation',
      );
    }

    return candidate;
  }

  // docs/06-cas-utilisation.md UC-001, cas d'erreur: finds technicians in
  // the team(s) matching the category, falling back to all active
  // technicians (generalistes) if no team is configured for it, and returns
  // whichever candidate currently has the fewest open tickets. Returns null
  // rather than throwing when nobody is available at all, so automatic
  // assignment at ticket creation can degrade to "unassigned" instead of
  // failing the whole creation.
  private async findLeastLoadedTechnician(categoryId: string) {
    const matchingTeams = await this.prisma.team.findMany({
      where: { categoryId },
      select: { id: true },
    });
    const teamIds = matchingTeams.map((team) => team.id);

    const candidates = await this.prisma.user.findMany({
      where: {
        role: Role.TECHNICIAN,
        isActive: true,
        ...(teamIds.length > 0 ? { teamId: { in: teamIds } } : {}),
      },
      select: { id: true, displayName: true, email: true },
    });

    if (candidates.length === 0) return null;

    const openCounts = await this.prisma.ticket.groupBy({
      by: ['technicianId'],
      where: {
        technicianId: { in: candidates.map((candidate) => candidate.id) },
        status: { in: OPEN_STATUSES },
      },
      _count: { _all: true },
    });
    const openCountByTechnicianId = new Map(
      openCounts.map((entry) => [entry.technicianId, entry._count._all]),
    );

    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        openTicketCount: openCountByTechnicianId.get(candidate.id) ?? 0,
      }))
      .sort((a, b) => a.openTicketCount - b.openTicketCount);

    return ranked[0];
  }

  // docs/06-cas-utilisation.md UC-004: reserve a l'employe proprietaire,
  // uniquement une fois le ticket resolu
  async rate(id: string, requesterId: string, dto: RateTicketDto) {
    const ticket = await this.findOne(id);

    if (ticket.employeeId !== requesterId) {
      throw new ForbiddenException(
        "Seul l'employé propriétaire du ticket peut l'évaluer",
      );
    }
    if (ticket.status !== TicketStatus.RESOLVED) {
      throw new BadRequestException('Seul un ticket résolu peut être évalué');
    }

    return this.prisma.ticket.update({
      where: { id },
      data: {
        rating: dto.rating,
        ratingComment: dto.comment,
        ratedAt: new Date(),
      },
      include: TICKET_INCLUDE,
    });
  }

  async update(
    id: string,
    dto: UpdateTicketDto,
    changedById: string,
    requesterRole: Role,
  ) {
    // RM-04: a technician may only modify tickets assigned to them;
    // supervisor/admin bypass this check inside assertTicketVisible.
    const existing = await this.findOne(id, {
      userId: changedById,
      role: requesterRole,
    });

    const isResolved = dto.status === TicketStatus.RESOLVED;
    const isStatusChange = !!dto.status && dto.status !== existing.status;

    // BR-07 correction: a priority change recomputes the SLA deadline from
    // the ticket's original creation time (not from now) using the new
    // priority's policy — otherwise correcting a miscategorized ticket to
    // "Urgente" would silently keep the old, looser deadline. Basing it on
    // createdAt (rather than resetting the clock to the moment of the
    // correction) reflects what the deadline would have been had the ticket
    // been triaged correctly from the start, and isn't gameable by
    // temporarily lowering then restoring the priority.
    const isPriorityChange =
      !!dto.priorityId && dto.priorityId !== existing.priorityId;
    const newSlaPolicy = isPriorityChange
      ? await this.prisma.slaPolicy.findUnique({
          where: { priorityId: dto.priorityId },
        })
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          priorityId: dto.priorityId,
          title: dto.title,
          summary: dto.summary,
          technicianId: dto.technicianId,
          ciId: dto.ciId,
          status: dto.status,
          resolvedAt: isResolved ? new Date() : undefined,
          resolutionNote: dto.resolutionNote,
          ...(isPriorityChange
            ? {
                slaDueAt: newSlaPolicy
                  ? new Date(
                      existing.createdAt.getTime() +
                        newSlaPolicy.resolutionHours * 60 * 60 * 1000,
                    )
                  : null,
              }
            : {}),
        },
        include: TICKET_INCLUDE,
      });

      if (isStatusChange) {
        await tx.ticketStatusHistory.create({
          data: {
            ticketId: id,
            fromStatus: existing.status,
            toStatus: dto.status as TicketStatus,
            changedById,
          },
        });
      }

      return ticket;
    });

    const isNewAssignment =
      !!dto.technicianId && dto.technicianId !== existing.technicianId;

    if (isNewAssignment) {
      this.realtimeGateway.emitToUser(
        dto.technicianId as string,
        'ticket.assigned',
        updated,
      );
      await this.createAssignmentNotification(
        updated,
        dto.technicianId as string,
      );
    }

    if (isStatusChange) {
      this.emitStatusChanged(updated, changedById);
      await this.notifyOnStatusChange(
        updated,
        existing.status,
        dto.status as TicketStatus,
        changedById,
      );
    }

    // docs/10-architecture-rag.md §11 "Apprentissage continu": chaque
    // passage a RESOLVED propose un article de connaissance (jamais indexe
    // avant validation humaine explicite, voir KnowledgeService). Best-
    // effort: un echec de generation IA ne doit jamais faire echouer la
    // resolution du ticket elle-meme.
    if (isStatusChange && isResolved) {
      try {
        await this.knowledgeService.proposeArticleFromTicket(id);
      } catch (error) {
        console.error('Failed to propose knowledge article', error);
      }
    }

    return updated;
  }

  // docs/06-cas-utilisation.md UC-001 postcondition: "notification envoyée
  // au technicien assigné" — shared by the automatic assignment at creation
  // and manual (re)assignment via update().
  private async createAssignmentNotification(
    ticket: { id: string; reference: string },
    technicianId: string,
  ) {
    try {
      await this.notificationsService.create({
        recipientId: technicianId,
        type: NotificationType.TICKET_ASSIGNED,
        message: `Vous avez été assigné au ticket ${ticket.reference}`,
        ticketId: ticket.id,
      });
    } catch (error) {
      // best-effort: a notification failure shouldn't fail the ticket create/update
      console.error('Failed to create ticket assignment notification', error);
    }
  }

  // docs/11-documentation-api.md §13: ticket.statusChanged, meme public
  // cible que la notification persistee (proprietaire + technicien,
  // excluant l'auteur du changement qui a deja sa propre vue a jour).
  private emitStatusChanged(
    ticket: { id: string; employeeId: string; technicianId: string | null },
    changedById: string,
  ) {
    const recipientIds = new Set<string>();
    if (ticket.employeeId !== changedById) recipientIds.add(ticket.employeeId);
    if (ticket.technicianId && ticket.technicianId !== changedById) {
      recipientIds.add(ticket.technicianId);
    }

    for (const recipientId of recipientIds) {
      this.realtimeGateway.emitToUser(
        recipientId,
        'ticket.statusChanged',
        ticket,
      );
    }
  }

  // Notifies the ticket owner and the assigned technician, excluding whoever made the change
  private async notifyOnStatusChange(
    ticket: {
      id: string;
      reference: string;
      employeeId: string;
      technicianId: string | null;
    },
    fromStatus: TicketStatus,
    toStatus: TicketStatus,
    changedById: string,
  ) {
    const recipientIds = new Set<string>();
    if (ticket.employeeId !== changedById) recipientIds.add(ticket.employeeId);
    if (ticket.technicianId && ticket.technicianId !== changedById)
      recipientIds.add(ticket.technicianId);

    try {
      await Promise.all(
        [...recipientIds].map((recipientId) =>
          this.notificationsService.create({
            recipientId,
            type: NotificationType.STATUS_CHANGED,
            message: `Le ticket ${ticket.reference} est passé de ${STATUS_LABELS[fromStatus]} à ${STATUS_LABELS[toStatus]}`,
            ticketId: ticket.id,
          }),
        ),
      );
    } catch (error) {
      // best-effort: a notification failure shouldn't fail the ticket update
      console.error('Failed to create status-change notification', error);
    }
  }
}
