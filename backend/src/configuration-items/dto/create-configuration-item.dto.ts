import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Criticality, CiStatus } from '../../../generated/prisma/client';
import { SetCiWarrantyDto } from './set-ci-warranty.dto';
import { SetCiLicenseDto } from './set-ci-license.dto';

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

  @ApiPropertyOptional({
    example: 'Dell',
    description:
      "Nom du fabricant — créé automatiquement s'il n'existe pas encore",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  manufacturerName?: string;

  @ApiPropertyOptional({
    example: 'Latitude 5420',
    description:
      "Nom du modèle — nécessite un fabricant (manufacturerName, ou déjà renseigné sur ce CI). Créé automatiquement s'il n'existe pas encore",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  modelName?: string;

  @ApiPropertyOptional({ type: SetCiWarrantyDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SetCiWarrantyDto)
  warranty?: SetCiWarrantyDto;

  @ApiPropertyOptional({ type: SetCiLicenseDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SetCiLicenseDto)
  license?: SetCiLicenseDto;
}
