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

  // docs/06-cas-utilisation.md UC-001 étape 7 : quand le ticket provient
  // d'une conversation de diagnostic (POST /diagnostics) dont le problème
  // persiste, relie la conversation au ticket créé (AiConversation passe à
  // ESCALATED) pour la traçabilité — voir TicketsService.create.
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  // docs/02-brd.md BR-07 : catégorie/priorité suggérée par l'IA au moment
  // du diagnostic (ai-diagnose ou diagnostic conversationnel), figée avant
  // toute modification manuelle du formulaire — alimente le taux de
  // correction manuelle du tableau de bord (DashboardService).
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  aiSuggestedCategoryId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  aiSuggestedPriorityId?: string;
}
