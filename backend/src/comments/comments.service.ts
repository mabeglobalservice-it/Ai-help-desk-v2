import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../generated/prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.ticketComment.create({
      data: {
        ticketId,
        authorId: requester.userId,
        content: dto.content,
      },
      include: { author: { select: AUTHOR_SELECT } },
    });
  }
}
