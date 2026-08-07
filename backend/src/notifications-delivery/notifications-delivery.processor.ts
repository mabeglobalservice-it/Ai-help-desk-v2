import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  EmailService,
  SendNotificationEmailInput,
} from '../email/email.service';
import {
  ChatNotificationsService,
  SendChatNotificationInput,
} from '../chat-notifications/chat-notifications.service';
import {
  CHAT_JOB_NAME,
  EMAIL_JOB_NAME,
  NOTIFICATIONS_DELIVERY_QUEUE,
} from './notifications-delivery.constants';
import { getWorkerRedisConnectionOptions } from './redis-connection.util';

// Même logique métier que l'ancien appel direct dans NotificationsService.create()
// (email + webhooks Teams/Slack) — seulement déplacée hors du chemin de
// requête. Si `process()` lève (échec transitoire d'un des deux services),
// BullMQ retente le job selon les options de retry passées à `queue.add()`
// (voir notifications-delivery.service.ts) plutôt que de perdre la
// notification.
//
// Connexion Redis dédiée, distincte de celle du producteur
// (NotificationsDeliveryService) — voir redis-connection.util.ts pour le
// détail des deux configurations et pourquoi elles diffèrent.
@Processor(NOTIFICATIONS_DELIVERY_QUEUE, {
  connection: getWorkerRedisConnectionOptions(),
})
export class NotificationsDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsDeliveryProcessor.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly chatNotificationsService: ChatNotificationsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case EMAIL_JOB_NAME:
        await this.emailService.sendNotificationEmail(
          job.data as SendNotificationEmailInput,
        );
        return;
      case CHAT_JOB_NAME:
        await this.chatNotificationsService.sendNotification(
          job.data as SendChatNotificationInput,
        );
        return;
      default:
        this.logger.warn(`Job de type inconnu ignoré : "${job.name}"`);
    }
  }

  // Sans ce listener, une erreur de connexion Redis (ECONNREFUSED en boucle,
  // etc.) sur le Worker fait planter tout le process Node — pas seulement la
  // livraison des notifications.
  @OnWorkerEvent('error')
  onWorkerError(error: Error): void {
    this.logger.warn(
      `Connexion Redis/BullMQ en erreur (worker "${NOTIFICATIONS_DELIVERY_QUEUE}")`,
      error.message,
    );
  }
}
