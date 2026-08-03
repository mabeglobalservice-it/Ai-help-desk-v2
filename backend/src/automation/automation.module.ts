import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';

@Module({
  imports: [
    AuditLogModule,
    NotificationsModule,
    RealtimeModule,
    AiModule,
    KnowledgeModule,
    // docs/06-cas-utilisation.md UC-015 : la résolution automatique échouée
    // (RM-03 revérifié à la confirmation) crée un ticket standard via
    // TicketsService — import à sens unique, TicketsModule n'importe pas
    // AutomationModule.
    TicketsModule,
  ],
  controllers: [AutomationController],
  providers: [AutomationService],
})
export class AutomationModule {}
