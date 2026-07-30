import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [NotificationsModule, AiModule, RealtimeModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
