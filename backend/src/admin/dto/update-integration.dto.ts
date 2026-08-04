import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

// docs/11-documentation-api.md §12 (PATCH /admin/integrations/:name).
export class UpdateIntegrationDto {
  @ApiProperty({
    description:
      "Active ou désactive cette intégration sans toucher aux variables d'environnement",
  })
  @IsBoolean()
  isEnabled: boolean;
}
