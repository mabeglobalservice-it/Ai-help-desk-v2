import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [AuditLogModule, NotificationsModule, RealtimeModule],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule {}
