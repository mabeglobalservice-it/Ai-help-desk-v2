import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateTicketDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  priorityId: string;

  @ApiProperty({ example: "L'écran ne s'allume plus" })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Technicien assigné' })
  @IsOptional()
  @IsUUID()
  technicianId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Configuration Item concerné',
  })
  @IsOptional()
  @IsUUID()
  ciId?: string;
}
