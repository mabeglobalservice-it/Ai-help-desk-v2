import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// docs/11-documentation-api.md §7 (POST /knowledge/documents) : le niveau
// n'est acceptable que pour un Admin (1, 2 ou 4 — jamais 3 "tickets résolus"
// ni 5 "personnel", alimentés automatiquement ailleurs) ; un Technicien qui
// téléverse une note personnelle n'a pas à le préciser, le service force le
// niveau 5 dans ce cas (voir KnowledgeService.createDocument).
export class CreateKnowledgeDocumentDto {
  @ApiProperty({ example: 'Procédure de réinitialisation du VPN' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ description: 'Contenu brut du document (texte)' })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  content: string;

  @ApiPropertyOptional({
    enum: [1, 2, 4],
    description:
      'Réservé à un Admin (1=public/constructeur, 2=interne, 4=automatisation). Ignoré pour un Technicien, toujours indexé au niveau 5 (personnel).',
  })
  @IsOptional()
  @IsIn([1, 2, 4])
  knowledgeLevel?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  authorName?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sourceVersion?: string;
}
