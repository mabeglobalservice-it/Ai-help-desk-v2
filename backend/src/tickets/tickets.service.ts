import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType,
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
  ) {}

  private async generateReference(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.ticket.count();
    const sequence = String(count + 1).padStart(4, '0');
    return `TCK-${year}-${sequence}`;
  }

  async create(dto: CreateTicketDto) {
    const [reference, slaPolicy] = await Promise.all([
      this.generateReference(),
      this.prisma.slaPolicy.findUnique({
        where: { priorityId: dto.priorityId },
      }),
    ]);

    const slaDueAt = slaPolicy
      ? new Date(Date.now() + slaPolicy.resolutionHours * 60 * 60 * 1000)
      : null;

    return this.prisma.ticket.create({
      data: {
        reference,
        employeeId: dto.employeeId,
        categoryId: dto.categoryId,
        priorityId: dto.priorityId,
        title: dto.title,
        summary: dto.summary,
        technicianId: dto.technicianId,
        ciId: dto.ciId,
        slaDueAt,
      },
      include: TICKET_INCLUDE,
    });
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

  // Finds technicians in the team(s) matching the ticket's category, falling
  // back to all active technicians if no team is configured for it, and
  // suggests whichever candidate currently has the fewest open tickets.
  async suggestTechnician(id: string) {
    const ticket = await this.findOne(id);

    const matchingTeams = await this.prisma.team.findMany({
      where: { categoryId: ticket.categoryId },
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

    if (candidates.length === 0) {
      throw new NotFoundException(
        'Aucun technicien disponible pour suggérer une assignation',
      );
    }

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
      try {
        await this.notificationsService.create({
          recipientId: dto.technicianId as string,
          type: NotificationType.TICKET_ASSIGNED,
          message: `Vous avez été assigné au ticket ${updated.reference}`,
          ticketId: updated.id,
        });
      } catch (error) {
        // best-effort: a notification failure shouldn't fail the ticket update
        console.error('Failed to create ticket assignment notification', error);
      }
    }

    if (isStatusChange) {
      await this.notifyOnStatusChange(
        updated,
        existing.status,
        dto.status as TicketStatus,
        changedById,
      );
    }

    return updated;
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
