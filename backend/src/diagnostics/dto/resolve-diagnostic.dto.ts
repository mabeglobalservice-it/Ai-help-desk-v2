import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

// docs/06-cas-utilisation.md UC-001 étape 6.
export class ResolveDiagnosticDto {
  @ApiProperty({
    description:
      'true si les étapes suggérées ont résolu le problème (US-02, aucun ticket créé)',
  })
  @IsBoolean()
  resolved: boolean;
}
