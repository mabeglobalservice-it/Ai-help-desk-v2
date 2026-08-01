import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateAutomationRunDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  scriptId: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ticketId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ciId?: string;

  @ApiProperty({ example: 'Compte verrouillé après 5 tentatives' })
  @IsString()
  @IsNotEmpty()
  justification: string;
}
