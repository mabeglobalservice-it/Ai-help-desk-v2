import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ChatNotificationsService } from '../chat-notifications/chat-notifications.service';
import { NotificationType } from '../../generated/prisma/client';

interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  message: string;
  ticketId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly realtimeGateway: RealtimeGateway,
    private readonly chatNotificationsService: ChatNotificationsService,
  ) {}

  // docs/11-documentation-api.md §13: notification.new diffuse en temps
  // reel au destinataire, en plus de l'email et de la persistance en base.
  // docs/02-brd.md BR-12 : le meme evenement alimente aussi Teams/Slack
  // (best-effort, silencieux si aucun webhook n'est configure).
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

    if (recipient) {
      await this.emailService.sendNotificationEmail({
        to: recipient.email,
        displayName: recipient.displayName,
        type: input.type,
        message: input.message,
        ticketUrl,
      });
    }

    await this.chatNotificationsService.sendNotification({
      message: input.message,
      ticketUrl,
    });

    return notification;
  }

  findAllForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { recipientId: userId },
      orderBy: { createdAt: 'desc' },
    });
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
