import { NotificationsDeliveryProcessor } from './notifications-delivery.processor';
import {
  CHAT_JOB_NAME,
  EMAIL_JOB_NAME,
} from './notifications-delivery.constants';

// Même logique métier qu'avant l'introduction de la file (voir
// notifications.service.ts) : ce processor ne fait qu'appeler EmailService/
// ChatNotificationsService avec le payload du job — ces tests vérifient le
// routage par nom de job et la propagation des erreurs (nécessaire au retry
// BullMQ, voir notifications-delivery.service.ts).
describe('NotificationsDeliveryProcessor', () => {
  let processor: NotificationsDeliveryProcessor;
  let emailService: { sendNotificationEmail: jest.Mock };
  let chatNotificationsService: { sendNotification: jest.Mock };

  beforeEach(() => {
    emailService = {
      sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    chatNotificationsService = {
      sendNotification: jest.fn().mockResolvedValue(undefined),
    };
    processor = new NotificationsDeliveryProcessor(
      emailService as any,
      chatNotificationsService as any,
    );
  });

  it('delegates an "email" job to EmailService.sendNotificationEmail with the job payload', async () => {
    const payload = {
      to: 'employee@test.com',
      displayName: 'Employee',
      type: 'TICKET_ASSIGNED',
      message: 'Un ticket vous a été assigné',
    };

    await processor.process({ name: EMAIL_JOB_NAME, data: payload } as any);

    expect(emailService.sendNotificationEmail).toHaveBeenCalledWith(payload);
    expect(chatNotificationsService.sendNotification).not.toHaveBeenCalled();
  });

  it('delegates a "chat" job to ChatNotificationsService.sendNotification with the job payload', async () => {
    const payload = { message: 'SLA dépassé' };

    await processor.process({ name: CHAT_JOB_NAME, data: payload } as any);

    expect(chatNotificationsService.sendNotification).toHaveBeenCalledWith(
      payload,
    );
    expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('propagates an EmailService failure so BullMQ retries the job', async () => {
    emailService.sendNotificationEmail.mockRejectedValue(
      new Error('Resend API timeout (simulated)'),
    );

    await expect(
      processor.process({ name: EMAIL_JOB_NAME, data: {} } as any),
    ).rejects.toThrow('Resend API timeout (simulated)');
  });

  it('propagates a ChatNotificationsService failure so BullMQ retries the job', async () => {
    chatNotificationsService.sendNotification.mockRejectedValue(
      new Error('Webhook timeout (simulated)'),
    );

    await expect(
      processor.process({ name: CHAT_JOB_NAME, data: {} } as any),
    ).rejects.toThrow('Webhook timeout (simulated)');
  });

  it('ignores an unknown job name without throwing', async () => {
    await expect(
      processor.process({ name: 'unknown-job', data: {} } as any),
    ).resolves.toBeUndefined();
    expect(emailService.sendNotificationEmail).not.toHaveBeenCalled();
    expect(chatNotificationsService.sendNotification).not.toHaveBeenCalled();
  });

  it("logs a warning instead of crashing when the worker's Redis connection errors", () => {
    expect(() =>
      processor.onWorkerError(new Error('connect ECONNREFUSED 127.0.0.1:6379')),
    ).not.toThrow();
  });
});
