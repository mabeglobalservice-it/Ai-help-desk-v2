import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { SlaService } from '../sla/sla.service';
import { TicketStatus } from '../../generated/prisma/client';
import { DashboardStatsQueryDto } from './dto/dashboard-stats-query.dto';
import type { DashboardExportFormat } from './dto/export-dashboard-query.dto';

const OPEN_STATUSES = [
  TicketStatus.NEW,
  TicketStatus.IN_PROGRESS,
  TicketStatus.ESCALATED,
];

interface DateRangeWhere {
  createdAt: { gte?: Date; lte?: Date };
}

export interface DashboardStatsResult {
  totalOpen: number;
  totalResolved: number;
  averageResolutionHours: number | null;
  // docs/11-documentation-api.md §11 (GET /analytics/sla-compliance),
  // docs/12-maquettes-ui-ux.md §4.5 ("SLA respecté : 96%"). Percentage
  // (0-100) of resolved tickets with an SLA target that were resolved
  // on or before slaDueAt. null when no resolved ticket in the period had
  // an SLA target (never claims a misleading 0%/100%).
  slaComplianceRate: number | null;
  // docs/02-brd.md BR-07, §7 "Critères de succès" : pourcentage (0-100)
  // des tickets issus du flux IA (aiSuggestedCategoryId/PriorityId non
  // nuls) dont la catégorie ou la priorité finale diffère de la
  // suggestion — quel que soit le moment de la correction (formulaire
  // avant création, ou PATCH ultérieur). null si aucun ticket issu du
  // flux IA dans la période (jamais un 0%/100% trompeur).
  aiCorrectionRate: number | null;
  byCategory: { categoryId: string; categoryName: string; count: number }[];
  byTechnician: {
    technicianId: string;
    technicianName: string;
    count: number;
  }[];
}

interface DashboardExport {
  filename: string;
  contentType: string;
  body: string | Buffer;
}

function csvEscape(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slaService: SlaService,
  ) {}

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
    try {
      // Triggered on dashboard load rather than on a fixed schedule: simple,
      // and a supervisor/admin opening the dashboard is exactly the moment
      // this needs to be surfaced.
      await this.slaService.checkAndNotifyBreaches();
    } catch (error) {
      // best-effort: an SLA-check failure shouldn't break the dashboard
      this.logger.error('Failed to run SLA breach check', error);
    }

    return this.computeStats(query);
  }

  // docs/02-brd.md BR-11 / doc 12 §4.5: export du rapport affiché sur le
  // tableau de bord, aux memes filtres de dates. N'a pas besoin de
  // redeclencher la verification SLA (deja best-effort ailleurs).
  async exportReport(
    query: DashboardStatsQueryDto,
    format: DashboardExportFormat,
  ): Promise<DashboardExport> {
    const stats = await this.computeStats(query);
    const dateSuffix = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      return {
        filename: `rapport-tickets-${dateSuffix}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: this.toCsv(stats),
      };
    }

    return {
      filename: `rapport-tickets-${dateSuffix}.pdf`,
      contentType: 'application/pdf',
      body: await this.toPdf(stats, query),
    };
  }

  private async computeStats(
    query: DashboardStatsQueryDto,
  ): Promise<DashboardStatsResult> {
    const dateWhere = this.buildDateRangeWhere(query);

    const [
      totalOpen,
      totalResolved,
      resolvedTickets,
      categoryCounts,
      technicianCounts,
      categories,
      aiAssistedTickets,
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
        select: { createdAt: true, resolvedAt: true, slaDueAt: true },
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
      this.prisma.ticket.findMany({
        where: {
          ...dateWhere,
          OR: [
            { aiSuggestedCategoryId: { not: null } },
            { aiSuggestedPriorityId: { not: null } },
          ],
        },
        select: {
          categoryId: true,
          priorityId: true,
          aiSuggestedCategoryId: true,
          aiSuggestedPriorityId: true,
        },
      }),
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

    const ticketsWithSla = resolvedTickets.filter(
      (ticket) => ticket.slaDueAt !== null,
    );
    const slaComplianceRate = ticketsWithSla.length
      ? (ticketsWithSla.filter(
          (ticket) =>
            ticket.resolvedAt!.getTime() <= ticket.slaDueAt!.getTime(),
        ).length /
          ticketsWithSla.length) *
        100
      : null;

    const aiCorrectionRate = aiAssistedTickets.length
      ? (aiAssistedTickets.filter(
          (ticket) =>
            ticket.categoryId !== ticket.aiSuggestedCategoryId ||
            ticket.priorityId !== ticket.aiSuggestedPriorityId,
        ).length /
          aiAssistedTickets.length) *
        100
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
      slaComplianceRate,
      aiCorrectionRate,
      byCategory,
      byTechnician,
    };
  }

  private toCsv(stats: DashboardStatsResult): string {
    const lines: string[] = [];

    lines.push('Indicateur,Valeur');
    lines.push(`Tickets ouverts,${stats.totalOpen}`);
    lines.push(`Tickets résolus,${stats.totalResolved}`);
    lines.push(
      `Temps moyen de résolution (h),${stats.averageResolutionHours !== null ? stats.averageResolutionHours.toFixed(2) : ''}`,
    );
    lines.push(
      `Taux de respect des SLA (%),${stats.slaComplianceRate !== null ? stats.slaComplianceRate.toFixed(1) : ''}`,
    );
    lines.push(
      `Taux de correction manuelle IA (%),${stats.aiCorrectionRate !== null ? stats.aiCorrectionRate.toFixed(1) : ''}`,
    );
    lines.push('');

    lines.push('Catégorie,Nombre de tickets');
    for (const entry of stats.byCategory) {
      lines.push(`${csvEscape(entry.categoryName)},${entry.count}`);
    }
    lines.push('');

    lines.push('Technicien,Nombre de tickets');
    for (const entry of stats.byTechnician) {
      lines.push(`${csvEscape(entry.technicianName)},${entry.count}`);
    }

    return lines.join('\r\n');
  }

  private async toPdf(
    stats: DashboardStatsResult,
    range: DashboardStatsQueryDto,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Rapport de tickets — AI Help Desk');
      doc.moveDown(0.3);
      const rangeLabel =
        range.from || range.to
          ? `Période : ${range.from ?? '…'} au ${range.to ?? '…'}`
          : 'Période : toutes les dates';
      doc.fontSize(10).fillColor('#555555').text(rangeLabel);
      doc.fillColor('#000000');
      doc.moveDown(1.2);

      doc.fontSize(13).text('Indicateurs clés');
      doc.moveDown(0.3);
      doc.fontSize(11);
      doc.text(`Tickets ouverts : ${stats.totalOpen}`);
      doc.text(`Tickets résolus : ${stats.totalResolved}`);
      doc.text(
        `Temps moyen de résolution : ${
          stats.averageResolutionHours !== null
            ? `${stats.averageResolutionHours.toFixed(1)} h`
            : '—'
        }`,
      );
      doc.text(
        `Taux de respect des SLA : ${
          stats.slaComplianceRate !== null
            ? `${stats.slaComplianceRate.toFixed(1)} %`
            : '—'
        }`,
      );
      doc.text(
        `Taux de correction manuelle IA : ${
          stats.aiCorrectionRate !== null
            ? `${stats.aiCorrectionRate.toFixed(1)} %`
            : '—'
        }`,
      );
      doc.moveDown(1);

      doc.fontSize(13).text('Répartition par catégorie');
      doc.moveDown(0.3);
      doc.fontSize(11);
      if (stats.byCategory.length === 0) {
        doc.text('Aucun ticket.');
      } else {
        for (const entry of stats.byCategory) {
          doc.text(`${entry.categoryName} — ${entry.count}`);
        }
      }
      doc.moveDown(1);

      doc.fontSize(13).text('Répartition par technicien');
      doc.moveDown(0.3);
      doc.fontSize(11);
      if (stats.byTechnician.length === 0) {
        doc.text('Aucun ticket assigné.');
      } else {
        for (const entry of stats.byTechnician) {
          doc.text(`${entry.technicianName} — ${entry.count}`);
        }
      }

      doc.end();
    });
  }
}
