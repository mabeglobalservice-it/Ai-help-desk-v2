import { Module } from '@nestjs/common';
import { ChatNotificationsService } from './chat-notifications.service';

@Module({
  providers: [ChatNotificationsService],
  exports: [ChatNotificationsService],
})
export class ChatNotificationsModule {}
