import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// docs/06-cas-utilisation.md UC-015 étape 4 : l'employé accepte la
// réparation automatique proposée par POST /automation/auto-resolve.
// confidence est celle renvoyée par la proposition — purement informative
// pour l'audit/la documentation générée (§8), jamais utilisée comme
// contrôle de sécurité : RM-03 (script encore non sensible ?) est
// revérifié côté serveur à partir de la base, jamais du corps de la
// requête.
export class ConfirmAutoResolutionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  scriptId: string;

  @ApiProperty({ minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence: number;
}
