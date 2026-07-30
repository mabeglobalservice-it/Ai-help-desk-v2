import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { DashboardStatsQueryDto } from './dashboard-stats-query.dto';

export type DashboardExportFormat = 'csv' | 'pdf';

export class ExportDashboardQueryDto extends DashboardStatsQueryDto {
  @ApiProperty({ enum: ['csv', 'pdf'] })
  @IsIn(['csv', 'pdf'])
  format: DashboardExportFormat;
}
