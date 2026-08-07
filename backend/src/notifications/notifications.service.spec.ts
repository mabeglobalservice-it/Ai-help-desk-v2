import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ChatNotificationsService } from '../chat-notifications/chat-notifications.service';
import { NotificationsDeliveryService } from '../notifications-delivery/notifications-delivery.service';
import { NOTIFICATION_TEMPLATES } from './notification-templates';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: {
    notification: { create: jest.Mock };
    user: { findUnique: jest.Mock };
  };
  let emailService: { sendNotificationEmail: jest.Mock };
  let realtimeGateway: { emitToUser: jest.Mock };
  let chatNotificationsService: { sendNotification: jest.Mock };
  let notificationsDeliveryService: {
    enqueueEmail: jest.Mock;
    enqueueChat: jest.Mock;
  };

  const recipient = { email: 'employee@test.com', displayName: 'Employee' };
  const createdNotification = { id: 'notif-1', recipientId: 'user-1' };

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn().mockResolvedValue(createdNotification),
      },
      user: { findUnique: jest.fn().mockResolvedValue(recipient) },
    };
    emailService = { sendNotificationEmail: jest.fn() };
    realtimeGateway = { emitToUser: jest.fn() };
    chatNotificationsService = { sendNotification: jest.fn() };
    // docs/07-architecture-logicielle.md §"Files d'attente (BullMQ)" : par
    // défaut, simule le cas nominal (Redis disponible, job mis en file).
    notificationsDeliveryService = {
      enqueueEmail: jest.fn().mockResolvedValue(true),
      enqueueChat: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: emailService },
        { provide: RealtimeGateway, useValue: realtimeGateway },
        {
          provide: ChatNotificationsService,
          useValue: chatNotificationsService,
        },
        {
          provide: NotificationsDeliveryService,
          useValue: notificationsDeliveryService,
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  // docs/07-architecture-logicielle.md §"Files d'attente (BullMQ)" :
  // NotificationsService.create() persiste et diffuse en temps réel de façon
  // synchrone, mais déporte l'email et la notification chat vers la file
  // BullMQ "notifications-delivery" plutôt que de les envoyer directement.
  describe('create', () => {
    it('enqueues an email job with the recipient/message payload instead of sending directly', async () => {
      await service.create({
        recipientId: 'user-1',
        type: 'TICKET_ASSIGNED',
        message: 'Un ticket vous a été assigné',
        ticketId: 'ticket-1',
      });

      expect(notificationsDeliveryService.enqueueEmail).toHaveBeenCalledWith({
        to: recipient.email,
        displayName: recipient.displayName,
        type: 'TICKET_ASSIGNED',
        message: 'Un ticket vous a été assigné',
        ticketUrl: expect.stringContaining('/tickets/ticket-1'),
      });
      expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('enqueues a chat job with the message payload instead of sending directly', async () => {
      await service.create({
        recipientId: 'user-1',
        type: 'TICKET_ASSIGNED',
        message: 'Un ticket vous a été assigné',
      });

      expect(notificationsDeliveryService.enqueueChat).toHaveBeenCalledWith({
        message: 'Un ticket vous a été assigné',
        ticketUrl: undefined,
      });
      expect(chatNotificationsService.sendNotification).not.toHaveBeenCalled();
    });

    it('does not enqueue (or send) an email when the recipient cannot be found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.create({
        recipientId: 'user-1',
        type: 'TICKET_ASSIGNED',
        message: 'Un ticket vous a été assigné',
      });

      expect(notificationsDeliveryService.enqueueEmail).not.toHaveBeenCalled();
      expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
    });

    it('still persists and broadcasts the notification synchronously and returns it', async () => {
      const result = await service.create({
        recipientId: 'user-1',
        type: 'TICKET_ASSIGNED',
        message: 'Un ticket vous a été assigné',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          recipientId: 'user-1',
          type: 'TICKET_ASSIGNED',
          message: 'Un ticket vous a été assigné',
        },
      });
      expect(realtimeGateway.emitToUser).toHaveBeenCalledWith(
        'user-1',
        'notification.new',
        createdNotification,
      );
      expect(result).toBe(createdNotification);
    });

    // RM-05 : repli synchrone si Redis/BullMQ est indisponible.
    it('falls back to sending the email synchronously when the queue is unavailable', async () => {
      notificationsDeliveryService.enqueueEmail.mockResolvedValue(false);

      await service.create({
        recipientId: 'user-1',
        type: 'TICKET_ASSIGNED',
        message: 'Un ticket vous a été assigné',
      });

      expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: recipient.email }),
      );
    });

    it('falls back to sending the chat notification synchronously when the queue is unavailable', async () => {
      notificationsDeliveryService.enqueueChat.mockResolvedValue(false);

      await service.create({
        recipientId: 'user-1',
        type: 'TICKET_ASSIGNED',
        message: 'Un ticket vous a été assigné',
      });

      expect(chatNotificationsService.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Un ticket vous a été assigné' }),
      );
    });

    it('does not fail notification creation when the synchronous fallback email send itself fails', async () => {
      notificationsDeliveryService.enqueueEmail.mockResolvedValue(false);
      emailService.sendNotificationEmail.mockRejectedValue(
        new Error('Resend API timeout (simulated)'),
      );

      await expect(
        service.create({
          recipientId: 'user-1',
          type: 'TICKET_ASSIGNED',
          message: 'Un ticket vous a été assigné',
        }),
      ).resolves.toBe(createdNotification);
    });

    it('does not fail notification creation when the synchronous fallback chat send itself fails', async () => {
      notificationsDeliveryService.enqueueChat.mockResolvedValue(false);
      chatNotificationsService.sendNotification.mockRejectedValue(
        new Error('Teams/Slack webhook timeout (simulated)'),
      );

      await expect(
        service.create({
          recipientId: 'user-1',
          type: 'TICKET_ASSIGNED',
          message: 'Un ticket vous a été assigné',
        }),
      ).resolves.toBe(createdNotification);
    });
  });

  // docs/11-documentation-api.md §10 (GET /notifications/templates).
  describe('getTemplates', () => {
    it('returns one template per NotificationType, matching the static registry', () => {
      const result = service.getTemplates();

      expect(result).toEqual(Object.values(NOTIFICATION_TEMPLATES));
      expect(result.length).toBe(6);
    });

    it('includes an emailSubject and at least one channel for every template', () => {
      const result = service.getTemplates();

      for (const template of result) {
        expect(typeof template.emailSubject).toBe('string');
        expect(template.emailSubject.length).toBeGreaterThan(0);
        expect(template.channels.length).toBeGreaterThan(0);
      }
    });
  });
});
