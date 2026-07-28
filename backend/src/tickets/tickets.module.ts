import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [NotificationsModule],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
