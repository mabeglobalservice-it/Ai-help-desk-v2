import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { SendNotificationEmailInput } from '../email/email.service';
import type { SendChatNotificationInput } from '../chat-notifications/chat-notifications.service';
import {
  CHAT_JOB_NAME,
  EMAIL_JOB_NAME,
  ENQUEUE_TIMEOUT_MS,
  NOTIFICATIONS_DELIVERY_QUEUE,
} from './notifications-delivery.constants';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Délai dépassé (${ms}ms)`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// docs/07-architecture-logicielle.md §"Files d'attente (BullMQ)" : découple
// l'envoi de l'email/webhook (lent, dépendant d'un service externe) du
// chemin de requête de NotificationsService.create() (voir ce fichier pour
// le contexte complet, notamment le repli synchrone RM-05).
//
// enqueueEmail()/enqueueChat() renvoient `true` si le job a bien été mis en
// file, `false` sinon (Redis indisponible, timeout, erreur BullMQ) — c'est à
// l'appelant (NotificationsService) de décider quoi faire d'un `false` (ici :
// envoyer directement, de façon synchrone). Cette méthode ne lève jamais.
@Injectable()
export class NotificationsDeliveryService {
  private readonly logger = new Logger(NotificationsDeliveryService.name);

  constructor(
    @InjectQueue(NOTIFICATIONS_DELIVERY_QUEUE) private readonly queue: Queue,
  ) {
    // Un Queue/Worker BullMQ sans listener 'error' fait planter le process
    // Node entier sur une erreur de connexion Redis (ECONNREFUSED en boucle,
    // etc.) — voir aussi @OnWorkerEvent('error') côté processor.
    this.queue.on('error', (error) => {
      this.logger.warn(
        `Connexion Redis/BullMQ en erreur (file "${NOTIFICATIONS_DELIVERY_QUEUE}")`,
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  async enqueueEmail(payload: SendNotificationEmailInput): Promise<boolean> {
    return this.enqueue(EMAIL_JOB_NAME, payload);
  }

  async enqueueChat(payload: SendChatNotificationInput): Promise<boolean> {
    return this.enqueue(CHAT_JOB_NAME, payload);
  }

  private async enqueue(name: string, data: unknown): Promise<boolean> {
    try {
      await withTimeout(
        this.queue.add(name, data, {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: true,
          removeOnFail: { count: 100 },
        }),
        ENQUEUE_TIMEOUT_MS,
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Redis/BullMQ indisponible, repli sur l'envoi synchrone (RM-05) pour le job "${name}"`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }
}
