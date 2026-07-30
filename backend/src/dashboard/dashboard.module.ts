import { Module } from '@nestjs/common';
import { SlaModule } from '../sla/sla.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [SlaModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
