import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, Role } from '../../generated/prisma/client';
import { CreateCommentDto } from './dto/create-comment.dto';

const AUTHOR_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
} as const;

interface Requester {
  userId: string;
  role: Role;
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private async findTicketOrThrow(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${ticketId} introuvable`);
    }

    return ticket;
  }

  async findAllForTicket(ticketId: string) {
    await this.findTicketOrThrow(ticketId);

    return this.prisma.ticketComment.findMany({
      where: { ticketId },
      include: { author: { select: AUTHOR_SELECT } },
      orderBy: { createdAt: 'asc' },
    });
  }

  // docs/11-documentation-api.md, module Tickets: POST /tickets/:id/comments
  // reserve a l'employe proprietaire et au technicien assigne
  async create(ticketId: string, requester: Requester, dto: CreateCommentDto) {
    const ticket = await this.findTicketOrThrow(ticketId);

    const isOwner = ticket.employeeId === requester.userId;
    const isAssignedTechnician = ticket.technicianId === requester.userId;
    const isPrivileged = requester.role === Role.SUPERVISOR || requester.role === Role.ADMIN;

    if (!isOwner && !isAssignedTechnician && !isPrivileged) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à commenter ce ticket");
    }

    const comment = await this.prisma.ticketComment.create({
      data: {
        ticketId,
        authorId: requester.userId,
        content: dto.content,
      },
      include: { author: { select: AUTHOR_SELECT } },
    });

    await this.notifyOnNewComment(ticket, requester.userId);

    return comment;
  }

  // Notifies the ticket owner and the assigned technician, excluding the comment's own author
  private async notifyOnNewComment(
    ticket: { id: string; reference: string; employeeId: string; technicianId: string | null },
    authorId: string,
  ) {
    const recipientIds = new Set<string>();
    if (ticket.employeeId !== authorId) recipientIds.add(ticket.employeeId);
    if (ticket.technicianId && ticket.technicianId !== authorId) recipientIds.add(ticket.technicianId);

    try {
      await Promise.all(
        [...recipientIds].map((recipientId) =>
          this.notificationsService.create({
            recipientId,
            type: NotificationType.NEW_COMMENT,
            message: `Nouveau commentaire sur le ticket ${ticket.reference}`,
            ticketId: ticket.id,
          }),
        ),
      );
    } catch (error) {
      // best-effort: a notification failure shouldn't fail comment creation
      console.error('Failed to create new-comment notification', error);
    }
  }
}
