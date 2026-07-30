import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SlaService } from './sla.service';

@Module({
  imports: [NotificationsModule, RealtimeModule],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
