import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType,
  Role,
  TicketStatus,
} from '../../generated/prisma/client';

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Finds tickets whose SLA deadline has passed without being resolved and
  // haven't been notified yet, notifies every active SUPERVISOR/ADMIN once
  // per ticket, then marks it as notified so it's never sent twice.
  async checkAndNotifyBreaches(): Promise<void> {
    const breachedTickets = await this.prisma.ticket.findMany({
      where: {
        slaDueAt: { lt: new Date() },
        slaBreachNotifiedAt: null,
        status: { not: TicketStatus.RESOLVED },
      },
      select: { id: true, reference: true },
    });

    if (breachedTickets.length === 0) return;

    const recipients = await this.prisma.user.findMany({
      where: { role: { in: [Role.SUPERVISOR, Role.ADMIN] }, isActive: true },
      select: { id: true },
    });

    for (const ticket of breachedTickets) {
      try {
        await Promise.all(
          recipients.map((recipient) =>
            this.notificationsService.create({
              recipientId: recipient.id,
              type: NotificationType.SLA_BREACHED,
              message: `Le ticket ${ticket.reference} a dépassé son délai de résolution (SLA)`,
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
}
