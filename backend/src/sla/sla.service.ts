import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  NotificationType,
  Role,
  TicketStatus,
} from '../../generated/prisma/client';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly auditLogService: AuditLogService,
  ) {}

  // docs/06-cas-utilisation.md UC-020: le superviseur consulte le delai de
  // resolution attendu par priorite avant de l'ajuster.
  findAllPolicies() {
    return this.prisma.slaPolicy.findMany({
      include: { priority: true },
      orderBy: { priority: { level: 'asc' } },
    });
  }

  // UC-020: seul le delai de resolution est ajustable ; la priorite et son
  // niveau restent fixes (definis via le catalogue). Le nouveau seuil ne
  // s'applique qu'aux tickets crees ensuite (les slaDueAt deja calcules ne
  // sont pas retroactivement recalcules).
  async updatePolicy(
    priorityId: string,
    dto: UpdateSlaPolicyDto,
    actorId: string,
  ) {
    const before = await this.prisma.slaPolicy.findUnique({
      where: { priorityId },
    });
    if (!before) {
      throw new NotFoundException(
        `Aucune politique SLA pour la priorité ${priorityId}`,
      );
    }

    const updated = await this.prisma.slaPolicy.update({
      where: { priorityId },
      data: { resolutionHours: dto.resolutionHours },
      include: { priority: true },
    });

    await this.auditLogService.record({
      actorId,
      action: 'SLA_POLICY_UPDATED',
      targetType: 'SlaPolicy',
      targetId: updated.id,
      beforeState: { resolutionHours: before.resolutionHours },
      afterState: { resolutionHours: updated.resolutionHours },
    });

    return updated;
  }

  // Finds tickets whose SLA deadline has passed without being resolved and
  // haven't been notified yet, notifies every active SUPERVISOR/ADMIN once
  // per ticket, then marks it as notified so it's never sent twice.
  //
  // docs/06-cas-utilisation.md UC-020 / docs/05-user-stories.md US-16: a
  // ticket that is still NEW (never taken in charge) when it breaches its
  // SLA is auto-escalated to ESCALATED. Tickets already IN_PROGRESS or
  // ESCALATED only get the breach notification, not a second escalation.
  //
  // Runs on a real schedule rather than only when a supervisor happens to
  // load the dashboard (docs/dashboard.service.ts also calls this on load
  // for an immediate check, but that's no longer the only trigger — a
  // breach is now detected within 5 minutes even if nobody opens the app).
  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkAndNotifyBreaches(): Promise<void> {
    const breachedTickets = await this.prisma.ticket.findMany({
      where: {
        slaDueAt: { lt: new Date() },
        slaBreachNotifiedAt: null,
        status: { not: TicketStatus.RESOLVED },
      },
      select: {
        id: true,
        reference: true,
        status: true,
        employeeId: true,
        technicianId: true,
      },
    });

    if (breachedTickets.length === 0) return;

    const recipients = await this.prisma.user.findMany({
      where: { role: { in: [Role.SUPERVISOR, Role.ADMIN] }, isActive: true },
      select: { id: true },
    });

    for (const ticket of breachedTickets) {
      const shouldEscalate = ticket.status === TicketStatus.NEW;

      // Escalation is done independently of the notification below (best
      // effort, immediate): it's the more important state change, and
      // shouldn't be held back by an email/notification hiccup.
      if (shouldEscalate) {
        try {
          await this.escalateTicket(ticket);
        } catch (error) {
          this.logger.error(
            `Failed to auto-escalate ticket ${ticket.id}`,
            error,
          );
        }
      }

      try {
        await Promise.all(
          recipients.map((recipient) =>
            this.notificationsService.create({
              recipientId: recipient.id,
              type: NotificationType.SLA_BREACHED,
              message: shouldEscalate
                ? `Le ticket ${ticket.reference} a dépassé son délai de résolution (SLA) et a été escaladé automatiquement (non pris en charge)`
                : `Le ticket ${ticket.reference} a dépassé son délai de résolution (SLA)`,
              ticketId: ticket.id,
            }),
          ),
        );

        await this.prisma.ticket.update({
          where: { id: ticket.id },
          data: { slaBreachNotifiedAt: new Date() },
        });
      } catch (error) {
        // best-effort: a failed notification just gets retried on the next check
        this.logger.error(
          `Failed to notify SLA breach for ticket ${ticket.id}`,
          error,
        );
      }
    }
  }

  private async escalateTicket(ticket: {
    id: string;
    reference: string;
    employeeId: string;
    technicianId: string | null;
  }) {
    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: TicketStatus.ESCALATED },
      }),
      this.prisma.ticketStatusHistory.create({
        data: {
          ticketId: ticket.id,
          fromStatus: TicketStatus.NEW,
          toStatus: TicketStatus.ESCALATED,
          changedById: null,
        },
      }),
    ]);

    const recipientIds = new Set<string>([ticket.employeeId]);
    if (ticket.technicianId) recipientIds.add(ticket.technicianId);

    for (const recipientId of recipientIds) {
      this.realtimeGateway.emitToUser(recipientId, 'ticket.statusChanged', {
        id: ticket.id,
        reference: ticket.reference,
        status: TicketStatus.ESCALATED,
      });
    }

    await Promise.all(
      [...recipientIds].map((recipientId) =>
        this.notificationsService.create({
          recipientId,
          type: NotificationType.STATUS_CHANGED,
          message: `Le ticket ${ticket.reference} a été escaladé automatiquement (délai SLA dépassé sans prise en charge)`,
          ticketId: ticket.id,
        }),
      ),
    );
  }
}
