import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [AuditLogModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
