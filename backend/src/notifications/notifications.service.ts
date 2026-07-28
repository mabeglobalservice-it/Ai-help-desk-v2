import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationType } from '../../generated/prisma/client';

interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  message: string;
  ticketId?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotificationInput) {
    return this.prisma.notification.create({ data: input });
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
