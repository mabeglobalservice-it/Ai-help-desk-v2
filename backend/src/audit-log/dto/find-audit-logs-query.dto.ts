import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class FindAuditLogsQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: "Filtre sur l'auteur de l'action",
  })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({
    example: 'User',
    description: 'Filtre sur le type de cible (ex. User, Team)',
  })
  @IsOptional()
  @IsString()
  targetType?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Filtre sur une cible précise',
  })
  @IsOptional()
  @IsUUID()
  targetId?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: 'Depuis cette date (incluse)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: "Jusqu'à cette date (incluse)",
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
