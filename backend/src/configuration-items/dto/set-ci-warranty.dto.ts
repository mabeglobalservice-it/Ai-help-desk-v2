import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// US-24 : le technicien doit voir la garantie d'un CI avant de decider
// reparer vs remplacer.
export class SetCiWarrantyDto {
  @ApiProperty({ example: 'Dell ProSupport' })
  @IsString()
  @IsNotEmpty()
  provider: string;

  @ApiProperty({ example: '2024-01-15' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2027-01-15' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
