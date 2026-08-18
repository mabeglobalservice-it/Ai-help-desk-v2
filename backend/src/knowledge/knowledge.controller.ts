import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
import { CreateKnowledgeDocumentDto } from './dto/create-knowledge-document.dto';

// docs/11-documentation-api.md §7, docs/05-user-stories.md US-26,
// docs/10-architecture-rag.md (RAG multi-niveaux : recherche + ingestion de
// documents, filtrage par droits d'accès au moment de la recherche, §10)
@ApiTags('knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.ADMIN)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @ApiOperation({
    summary:
      'Recherche parmi les 5 niveaux de connaissance (documents, tickets résolus, articles, scripts)',
    description:
      "Ouvert à EMPLOYEE (niveau 1 uniquement, doc 10 §10), TECHNICIAN/SUPERVISOR (niveaux 1-4 + ses propres notes niveau 5), ADMIN (tous niveaux). Recherche hybride embedding+lexicale (voir knowledge/rag), le filtrage par accès s'applique avant le calcul de pertinence.",
  })
  @Roles(Role.EMPLOYEE, Role.TECHNICIAN, Role.SUPERVISOR, Role.ADMIN)
  @Get('search')
  search(@Query() query: SearchKnowledgeQueryDto, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.knowledgeService.search(query.q, requester);
  }

  @ApiOperation({
    summary: 'Téléverse un nouveau document pour ingestion',
    description:
      'Technicien (niveau 5, personnel), Admin (niveaux 1, 2 ou 4) — doc 11 §7',
  })
  @Roles(Role.TECHNICIAN, Role.ADMIN)
  @Post('documents')
  createDocument(@Body() dto: CreateKnowledgeDocumentDto, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.knowledgeService.createDocument(dto, requester);
  }

  @ApiOperation({
    summary: "Détail d'un document indexé",
    description: "Réservé selon le niveau d'accès (doc 10, section 10)",
  })
  @Roles(Role.EMPLOYEE, Role.TECHNICIAN, Role.SUPERVISOR, Role.ADMIN)
  @Get('documents/:id')
  getDocument(@Param('id') id: string, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.knowledgeService.getDocument(id, requester);
  }

  @ApiOperation({
    summary: "Retire un document de l'index",
    description: 'Propriétaire (niveau 5), Admin',
  })
  @Roles(Role.TECHNICIAN, Role.ADMIN)
  @Delete('documents/:id')
  deleteDocument(@Param('id') id: string, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.knowledgeService.deleteDocument(id, requester);
  }

  @ApiOperation({
    summary: 'Indicateurs de qualité de la recherche RAG (doc 10 §12)',
    description:
      'Réservé aux rôles SUPERVISOR, ADMIN. Temps de recherche, score moyen de confiance, taux de réponses pertinentes, coût des appels IA, documents les plus consultés/obsolètes.',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get('quality-metrics')
  getQualityMetrics() {
    return this.knowledgeService.getQualityMetrics();
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
