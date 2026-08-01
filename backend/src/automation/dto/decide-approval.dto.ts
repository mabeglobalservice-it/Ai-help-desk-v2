import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApprovalStatus } from '../../../generated/prisma/client';

export class DecideApprovalDto {
  @ApiProperty({ enum: [ApprovalStatus.APPROVED, ApprovalStatus.REJECTED] })
  @IsEnum(ApprovalStatus)
  decision: ApprovalStatus;

  @ApiPropertyOptional({ description: 'Motif du rejet, consigné à l’audit' })
  @IsOptional()
  @IsString()
  note?: string;
}
