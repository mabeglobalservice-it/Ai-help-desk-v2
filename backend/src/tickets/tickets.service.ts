import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, TicketStatus } from '../../generated/prisma/client';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

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
    return this.prisma.ticket.create({
      data: {
        reference: await this.generateReference(),
        employeeId: dto.employeeId,
        categoryId: dto.categoryId,
        priorityId: dto.priorityId,
        title: dto.title,
        summary: dto.summary,
        technicianId: dto.technicianId,
        ciId: dto.ciId,
      },
      include: TICKET_INCLUDE,
    });
  }

  async findAll() {
    return this.prisma.ticket.findMany({
      include: TICKET_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: { ...TICKET_INCLUDE, statusHistory: { orderBy: { changedAt: 'desc' } } },
    });

    if (!ticket) {
      throw new NotFoundException(`Ticket ${id} introuvable`);
    }

    return ticket;
  }

  async update(id: string, dto: UpdateTicketDto) {
    const existing = await this.findOne(id);

    const isResolved = dto.status === TicketStatus.RESOLVED;

    const updated = await this.prisma.ticket.update({
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

    return updated;
  }
}
