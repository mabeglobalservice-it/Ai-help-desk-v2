import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { SlaController } from './sla.controller';
import { SlaService } from './sla.service';

@Module({
  imports: [NotificationsModule, RealtimeModule, AuditLogModule],
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
