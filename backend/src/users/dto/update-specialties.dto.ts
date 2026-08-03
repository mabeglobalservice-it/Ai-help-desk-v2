import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

// docs/06-cas-utilisation.md UC-031 étape 3 : remplace intégralement
// l'ensemble des spécialités du technicien (comme PATCH /users/:id pour le
// rôle) — envoyer un tableau vide retire toutes les spécialités.
export class UpdateSpecialtiesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Identifiants des catégories (réseau, matériel, logiciel, accès...)',
  })
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  categoryIds: string[];
}
