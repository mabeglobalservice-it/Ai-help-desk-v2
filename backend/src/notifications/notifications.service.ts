import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EmailService,
  SendNotificationEmailInput,
} from '../email/email.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  ChatNotificationsService,
  SendChatNotificationInput,
} from '../chat-notifications/chat-notifications.service';
import { NotificationsDeliveryService } from '../notifications-delivery/notifications-delivery.service';
import { NotificationType } from '../../generated/prisma/client';
import { NOTIFICATION_TEMPLATES } from './notification-templates';

interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  message: string;
  ticketId?: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly chatNotificationsService: ChatNotificationsService,
    private readonly notificationsDeliveryService: NotificationsDeliveryService,
  ) {}

  // docs/11-documentation-api.md §13: notification.new diffuse en temps
  // reel au destinataire, en plus de l'email et de la persistance en base.
  // docs/02-brd.md BR-12 : le meme evenement alimente aussi Teams/Slack
  // (best-effort, silencieux si aucun webhook n'est configure).
  //
  // docs/07-architecture-logicielle.md §"Files d'attente (BullMQ)" : la
  // persistance DB et la diffusion temps réel ci-dessus restent synchrones
  // (rapides, in-process) — seuls l'email et les webhooks Teams/Slack, lents
  // et dépendants de services externes, sont déportés vers la file BullMQ
  // "notifications-delivery" (src/notifications-delivery/) pour ne pas
  // ralentir le chemin de requête qui a déclenché la notification (ex.
  // création de ticket, commentaire, changement de statut).
  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({ data: input });

    this.realtimeGateway.emitToUser(
      input.recipientId,
      'notification.new',
      notification,
    );

    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { email: true, displayName: true },
    });

    const ticketUrl = input.ticketId
      ? `${process.env.FRONTEND_URL ?? 'http://localhost:3002'}/tickets/${input.ticketId}`
      : undefined;

    // Independantes l'une de l'autre (aucun ordre requis) : en parallele,
    // pour ne pas cumuler leurs delais de repli RM-05 respectifs quand
    // Redis/BullMQ est indisponible (voir notifications-delivery.constants.ts
    // ENQUEUE_TIMEOUT_MS — sequentiel doublerait la latence de chaque appel
    // a create(), un cout qui se multiplie encore par le nombre de
    // destinataires notifies pour un meme evenement, ex.
    // AutomationService.notifyEligibleApprovers).
    await Promise.all([
      recipient
        ? this.deliverEmail({
            to: recipient.email,
            displayName: recipient.displayName,
            type: input.type,
            message: input.message,
            ticketUrl,
          })
        : Promise.resolve(),
      this.deliverChat({ message: input.message, ticketUrl }),
    ]);

    return notification;
  }

  // RM-05 : si Redis/BullMQ est indisponible, enqueueEmail() renvoie `false`
  // (jamais une exception) et on retombe ici sur l'envoi synchrone
  // d'origine — identique au comportement d'avant l'introduction de la file,
  // y compris le fait qu'un email en échec ne doit jamais faire échouer la
  // création de la notification elle-même.
  private async deliverEmail(
    payload: SendNotificationEmailInput,
  ): Promise<void> {
    const queued =
      await this.notificationsDeliveryService.enqueueEmail(payload);
    if (queued) return;

    try {
      await this.emailService.sendNotificationEmail(payload);
    } catch (error) {
      this.logger.warn(
        "Échec de l'envoi synchrone (repli) de l'email de notification",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async deliverChat(payload: SendChatNotificationInput): Promise<void> {
    const queued = await this.notificationsDeliveryService.enqueueChat(payload);
    if (queued) return;

    try {
      await this.chatNotificationsService.sendNotification(payload);
    } catch (error) {
      this.logger.warn(
        "Échec de l'envoi synchrone (repli) de la notification chat",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  findAllForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // docs/11-documentation-api.md §10 (GET /notifications/templates) :
  // registre statique (voir notification-templates.ts), pas une table
  // éditable — aucun PATCH n'est documenté pour cet endpoint.
  getTemplates() {
    return Object.values(NOTIFICATION_TEMPLATES);
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.recipientId !== userId) {
      throw new NotFoundException(`Notification ${notificationId} introuvable`);
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
  }
}
