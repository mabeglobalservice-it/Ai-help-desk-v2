import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
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
  ) {}

  async create(input: CreateNotificationInput) {
    const notification = await this.prisma.notification.create({ data: input });

    const recipient = await this.prisma.user.findUnique({
      where: { id: input.recipientId },
      select: { email: true, displayName: true },
    });

    if (recipient) {
      await this.emailService.sendNotificationEmail({
        to: recipient.email,
        displayName: recipient.displayName,
        type: input.type,
        message: input.message,
        ticketUrl: input.ticketId
          ? `${process.env.FRONTEND_URL ?? 'http://localhost:3002'}/tickets/${input.ticketId}`
          : undefined,
      });
    }

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
