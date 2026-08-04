import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// docs/11-documentation-api.md §12 (PATCH /admin/settings).
export class UpdateSystemSettingsDto {
  @ApiPropertyOptional({ example: 'Acme Corp' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  organizationName?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    description:
      "Nombre maximal de questions de clarification posées par l'Agent Help Desk avant diagnostic forcé (docs/09 §3.2)",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxClarifyingTurns?: number;
}
