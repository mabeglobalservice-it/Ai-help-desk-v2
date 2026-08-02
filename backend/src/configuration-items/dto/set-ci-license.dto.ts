import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

// US-23 : le superviseur doit consulter les licences et leur date
// d'expiration pour anticiper les renouvellements.
export class SetCiLicenseDto {
  @ApiProperty({ example: 'Microsoft' })
  @IsString()
  @IsNotEmpty()
  vendor: string;

  @ApiProperty({ example: '2027-01-15' })
  @IsDateString()
  expiresAt: string;

  @ApiPropertyOptional({ example: '2024-01-15' })
  @IsOptional()
  @IsDateString()
  purchasedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
