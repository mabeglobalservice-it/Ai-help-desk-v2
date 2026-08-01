import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ScriptLanguage } from '../../../generated/prisma/client';

export class CreateScriptDto {
  @ApiProperty({ example: 'Redémarrer le service de spouleur d’impression' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: ScriptLanguage })
  @IsEnum(ScriptLanguage)
  language: ScriptLanguage;

  @ApiProperty({ example: 'Restart-Service -Name Spooler -Force' })
  @IsString()
  @IsNotEmpty()
  content: string;

  // docs/09-architecture-agents-ia.md §3.5: la distinction sensible/non-
  // sensible n'est jamais laissée à la discrétion du modèle — un script est
  // sensible par défaut tant qu'un Administrateur ne l'a pas explicitement
  // marqué comme sûr.
  @ApiPropertyOptional({
    default: true,
    description: 'Détermine si RM-01 s’applique (approbation requise)',
  })
  @IsOptional()
  @IsBoolean()
  isSensitive?: boolean;
}
