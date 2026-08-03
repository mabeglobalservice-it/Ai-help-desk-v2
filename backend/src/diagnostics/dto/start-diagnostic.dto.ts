import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// docs/06-cas-utilisation.md UC-001 étapes 1-6 : conversationId absent
// démarre une nouvelle conversation ; renseigné, message est la réponse de
// l'employé à la dernière question posée par l'Agent Help Desk.
export class StartDiagnosticDto {
  @ApiProperty({
    example: "Mon ordinateur n'arrive plus à se connecter au wifi.",
    description: 'Description du problème, ou réponse à la question précédente',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(2000)
  message: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
