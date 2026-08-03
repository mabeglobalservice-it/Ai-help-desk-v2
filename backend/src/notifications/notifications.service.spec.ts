import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ChatNotificationsService } from '../chat-notifications/chat-notifications.service';
import { NOTIFICATION_TEMPLATES } from './notification-templates';

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: {} },
        {
          provide: EmailService,
          useValue: { sendNotificationEmail: jest.fn() },
        },
        { provide: RealtimeGateway, useValue: { emitToUser: jest.fn() } },
        {
          provide: ChatNotificationsService,
          useValue: { sendNotification: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(NotificationsService);
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
