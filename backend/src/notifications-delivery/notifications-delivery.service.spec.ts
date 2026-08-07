import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationsDeliveryService } from './notifications-delivery.service';
import {
  CHAT_JOB_NAME,
  EMAIL_JOB_NAME,
  NOTIFICATIONS_DELIVERY_QUEUE,
} from './notifications-delivery.constants';

describe('NotificationsDeliveryService', () => {
  let service: NotificationsDeliveryService;
  let queue: { add: jest.Mock; on: jest.Mock };

  beforeEach(async () => {
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      on: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsDeliveryService,
        {
          provide: getQueueToken(NOTIFICATIONS_DELIVERY_QUEUE),
          useValue: queue,
        },
      ],
    }).compile();

    service = module.get(NotificationsDeliveryService);
  });

  it("attaches an 'error' listener to the queue so a Redis connection error never crashes the process", () => {
    expect(queue.on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  describe('enqueueEmail', () => {
    it('adds an "email" job with the exact payload and a retry/backoff policy', async () => {
      const payload = {
        to: 'employee@test.com',
        displayName: 'Employee',
        type: 'TICKET_ASSIGNED' as const,
        message: 'Un ticket vous a été assigné',
        ticketUrl: 'https://app.example.com/tickets/1',
      };

      const result = await service.enqueueEmail(payload);

      expect(result).toBe(true);
      expect(queue.add).toHaveBeenCalledWith(
        EMAIL_JOB_NAME,
        payload,
        expect.objectContaining({
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        }),
      );
    });
  });

  describe('enqueueChat', () => {
    it('adds a "chat" job with the exact payload and a retry/backoff policy', async () => {
      const payload = {
        message: 'SLA dépassé',
        ticketUrl: 'https://app.example.com/tickets/2',
      };

      const result = await service.enqueueChat(payload);

      expect(result).toBe(true);
      expect(queue.add).toHaveBeenCalledWith(
        CHAT_JOB_NAME,
        payload,
        expect.objectContaining({
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
        }),
      );
    });
  });

  // RM-05 : NotificationsService s'appuie sur ce `false` pour basculer sur
  // l'envoi synchrone — cette méthode ne doit jamais lever.
  describe('when Redis/BullMQ is unreachable', () => {
    it('returns false instead of throwing when queue.add() rejects', async () => {
      queue.add.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:6379'),
      );

      const result = await service.enqueueEmail({
        to: 'employee@test.com',
        displayName: 'Employee',
        type: 'TICKET_ASSIGNED' as const,
        message: 'Un ticket vous a été assigné',
      });

      expect(result).toBe(false);
    });

    it('returns false instead of hanging when queue.add() never resolves (connection stuck)', async () => {
      queue.add.mockReturnValue(new Promise(() => {}));

      const result = await service.enqueueChat({ message: 'SLA dépassé' });

      expect(result).toBe(false);
    }, 10000);
  });
});
