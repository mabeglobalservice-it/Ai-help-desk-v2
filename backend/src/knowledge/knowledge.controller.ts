import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { KnowledgeService } from './knowledge.service';
import { SearchKnowledgeQueryDto } from './dto/search-knowledge-query.dto';

// docs/11-documentation-api.md §7, docs/05-user-stories.md US-26
@ApiTags('knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.ADMIN)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @ApiOperation({
    summary: 'Recherche plein texte dans les tickets résolus',
    description:
      'Réservé aux rôles TECHNICIAN, SUPERVISOR, ADMIN (US-26). Recherche plein texte PostgreSQL (pas de recherche sémantique par embeddings) sur le titre et le résumé des tickets déjà résolus.',
  })
  @Get('search')
  search(@Query() query: SearchKnowledgeQueryDto) {
    return this.knowledgeService.search(query.q);
  }
}
