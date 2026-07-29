import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TicketStatus } from '../../../generated/prisma/client';

export class FindTicketsQueryDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  priorityId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filtre sur le technicien assigné',
  })
  @IsOptional()
  @IsUUID()
  technicianId?: string;
}
