import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { Criticality, CiStatus } from '../../../generated/prisma/client';

export class FindConfigurationItemsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ciTypeId?: string;

  @ApiPropertyOptional({ enum: Criticality })
  @IsOptional()
  @IsEnum(Criticality)
  criticality?: Criticality;

  @ApiPropertyOptional({ enum: CiStatus })
  @IsOptional()
  @IsEnum(CiStatus)
  status?: CiStatus;
}
