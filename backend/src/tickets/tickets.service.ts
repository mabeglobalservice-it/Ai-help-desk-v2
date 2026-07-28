import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketStatus } from '../../generated/prisma/client';
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
  constructor(private readonly prisma: PrismaService) {}

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
    await this.findOne(id);

    const isResolved = dto.status === TicketStatus.RESOLVED;

    return this.prisma.ticket.update({
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
  }
}
