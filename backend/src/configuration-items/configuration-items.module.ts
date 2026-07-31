import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ConfigurationItemsController } from './configuration-items.controller';
import { ConfigurationItemsService } from './configuration-items.service';

@Module({
  imports: [AuditLogModule],
  controllers: [ConfigurationItemsController],
  providers: [ConfigurationItemsService],
})
export class ConfigurationItemsModule {}
