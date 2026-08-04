import { Module } from '@nestjs/common';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuditLogModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
