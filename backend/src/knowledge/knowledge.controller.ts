import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { KnowledgeService } from './knowledge.service';
import { SearchKnowledgeQueryDto } from './dto/search-knowledge-query.dto';
import { DecideKnowledgeArticleDto } from './dto/decide-knowledge-article.dto';

// docs/11-documentation-api.md §7, docs/05-user-stories.md US-26,
// docs/10-architecture-rag.md §11 (Agent Documentation, apprentissage continu)
@ApiTags('knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.ADMIN)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @ApiOperation({
    summary:
      'Recherche plein texte dans les tickets résolus et les articles approuvés',
    description:
      'Réservé aux rôles TECHNICIAN, SUPERVISOR, ADMIN (US-26). Recherche plein texte PostgreSQL (pas de recherche sémantique par embeddings) sur le titre/résumé des tickets résolus et le titre/contenu des articles de connaissance approuvés.',
  })
  @Get('search')
  search(@Query() query: SearchKnowledgeQueryDto) {
    return this.knowledgeService.search(query.q);
  }

  @ApiOperation({
    summary: "Liste des articles de connaissance en attente d'approbation",
    description:
      'Réservé aux rôles SUPERVISOR, ADMIN (simplification de "Technicien senior" du doc 11 §7, non modélisé dans ce projet)',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get('articles/pending')
  findPendingArticles() {
    return this.knowledgeService.findPendingArticles();
  }

  @ApiOperation({
    summary: 'Approuve ou rejette un article de connaissance proposé',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Patch('articles/:id/approve')
  decideArticle(
    @Param('id') id: string,
    @Body() dto: DecideKnowledgeArticleDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.knowledgeService.decideArticle(
      id,
      dto.decision,
      requester.userId,
    );
  }
}
