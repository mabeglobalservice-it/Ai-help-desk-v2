import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class DashboardStatsQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    description:
      'Ne compte que les tickets créés à partir de cette date (incluse)',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: "Ne compte que les tickets créés jusqu'à cette date (incluse)",
    example: '2026-01-31',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
