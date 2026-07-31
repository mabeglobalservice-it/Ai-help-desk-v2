import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { Criticality, CiStatus } from '../../../generated/prisma/client';

export class CreateConfigurationItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Type de CI (poste, serveur, application...)',
  })
  @IsUUID()
  ciTypeId: string;

  @ApiProperty({ example: 'SRV-FICHIERS-01' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'INV-00123' })
  @IsString()
  @IsNotEmpty()
  inventoryNumber: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @ApiPropertyOptional({ enum: Criticality, default: Criticality.MEDIUM })
  @IsOptional()
  @IsEnum(Criticality)
  criticality?: Criticality;

  @ApiPropertyOptional({ enum: CiStatus, default: CiStatus.ACTIVE })
  @IsOptional()
  @IsEnum(CiStatus)
  status?: CiStatus;
}
