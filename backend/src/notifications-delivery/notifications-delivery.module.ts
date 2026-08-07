import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailModule } from '../email/email.module';
import { ChatNotificationsModule } from '../chat-notifications/chat-notifications.module';
import { NotificationsDeliveryService } from './notifications-delivery.service';
import { NotificationsDeliveryProcessor } from './notifications-delivery.processor';
import { NOTIFICATIONS_DELIVERY_QUEUE } from './notifications-delivery.constants';
import { getRedisConnectionOptions } from './redis-connection.util';

@Module({
  imports: [
    // `global: true` en interne (voir @nestjs/bullmq) : peut être enregistré
    // ici plutôt que dans AppModule sans dupliquer la configuration si
    // d'autres queues sont ajoutées un jour ailleurs dans le projet.
    BullModule.forRootAsync({
      useFactory: () => ({ connection: getRedisConnectionOptions() }),
    }),
    // `forceDisconnectOnShutdown: true` : à l'arrêt de l'app (ex.
    // `app.close()` en test e2e), force la fermeture de la connexion Redis
    // plutôt que d'attendre une déconnexion "gracieuse" qui peut ne jamais
    // aboutir si Redis n'a jamais été joignable.
    BullModule.registerQueue({
      name: NOTIFICATIONS_DELIVERY_QUEUE,
      forceDisconnectOnShutdown: true,
    }),
    EmailModule,
    ChatNotificationsModule,
  ],
  providers: [NotificationsDeliveryService, NotificationsDeliveryProcessor],
  exports: [NotificationsDeliveryService],
})
export class NotificationsDeliveryModule {}
