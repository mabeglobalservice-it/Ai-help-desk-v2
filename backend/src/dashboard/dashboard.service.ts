import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TicketStatus } from '../../generated/prisma/client';
import { DashboardStatsQueryDto } from './dto/dashboard-stats-query.dto';

const OPEN_STATUSES = [
  TicketStatus.NEW,
  TicketStatus.IN_PROGRESS,
  TicketStatus.ESCALATED,
];

interface DateRangeWhere {
  createdAt: { gte?: Date; lte?: Date };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // `to` is inclusive of the whole day, so it's bumped to 23:59:59.999
  private buildDateRangeWhere({
    from,
    to,
  }: DashboardStatsQueryDto): DateRangeWhere | undefined {
    if (!from && !to) return undefined;

    const createdAt: { gte?: Date; lte?: Date } = {};
    if (from) createdAt.gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      createdAt.lte = end;
    }

    return { createdAt };
  }

  async getStats(query: DashboardStatsQueryDto) {
    const dateWhere = this.buildDateRangeWhere(query);

    const [
      totalOpen,
      totalResolved,
      resolvedTickets,
      categoryCounts,
      technicianCounts,
      categories,
    ] = await Promise.all([
      this.prisma.ticket.count({
        where: { ...dateWhere, status: { in: OPEN_STATUSES } },
      }),
      this.prisma.ticket.count({
        where: { ...dateWhere, status: TicketStatus.RESOLVED },
      }),
      this.prisma.ticket.findMany({
        where: {
          ...dateWhere,
          status: TicketStatus.RESOLVED,
          resolvedAt: { not: null },
        },
        select: { createdAt: true, resolvedAt: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['categoryId'],
        where: dateWhere,
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['technicianId'],
        where: dateWhere,
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
