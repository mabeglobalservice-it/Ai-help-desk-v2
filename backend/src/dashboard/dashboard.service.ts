import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketStatus } from '../../generated/prisma/client';

const OPEN_STATUSES = [
  TicketStatus.NEW,
  TicketStatus.IN_PROGRESS,
  TicketStatus.ESCALATED,
];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [
      totalOpen,
      totalResolved,
      resolvedTickets,
      categoryCounts,
      technicianCounts,
      categories,
    ] = await Promise.all([
      this.prisma.ticket.count({ where: { status: { in: OPEN_STATUSES } } }),
      this.prisma.ticket.count({ where: { status: TicketStatus.RESOLVED } }),
      this.prisma.ticket.findMany({
        where: { status: TicketStatus.RESOLVED, resolvedAt: { not: null } },
        select: { createdAt: true, resolvedAt: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['categoryId'],
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['technicianId'],
        _count: { _all: true },
      }),
      this.prisma.ticketCategory.findMany({ select: { id: true, name: true } }),
    ]);

    const averageResolutionHours = resolvedTickets.length
      ? resolvedTickets.reduce(
          (sum, ticket) =>
            sum + (ticket.resolvedAt!.getTime() - ticket.createdAt.getTime()),
          0,
        ) /
        resolvedTickets.length /
        (1000 * 60 * 60)
      : null;

    const categoryNameById = new Map(
      categories.map((category) => [category.id, category.name]),
    );
    const byCategory = categoryCounts
      .map((entry) => ({
        categoryId: entry.categoryId,
        categoryName: categoryNameById.get(entry.categoryId) ?? 'Inconnue',
        count: entry._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const technicianIds = technicianCounts
      .map((entry) => entry.technicianId)
      .filter((id): id is string => id !== null);

    const technicians = await this.prisma.user.findMany({
      where: { id: { in: technicianIds } },
      select: { id: true, displayName: true },
    });
    const technicianNameById = new Map(
      technicians.map((tech) => [tech.id, tech.displayName]),
    );

    const byTechnician = technicianCounts
      .filter((entry) => entry.technicianId !== null)
      .map((entry) => ({
        technicianId: entry.technicianId as string,
        technicianName:
          technicianNameById.get(entry.technicianId as string) ?? 'Inconnu',
        count: entry._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      totalOpen,
      totalResolved,
      averageResolutionHours,
      byCategory,
      byTechnician,
    };
  }
}
