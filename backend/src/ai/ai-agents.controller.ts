import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { AiAgentsService } from './ai-agents.service';
import { SetActiveAiProviderDto } from './dto/set-active-ai-provider.dto';

// docs/11-documentation-api.md §6 : administration des agents IA et du
// fournisseur actif, réservée à l'Admin.
@ApiTags('ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('ai')
export class AiAgentsController {
  constructor(private readonly aiAgentsService: AiAgentsService) {}

  @ApiOperation({
    summary: 'Liste des agents IA enregistrés et leur statut',
    description: 'Réservé au rôle ADMIN',
  })
  @Get('agents')
  findAllAgents() {
    return this.aiAgentsService.findAllAgents();
  }

  @ApiOperation({
    summary: 'Active/désactive un agent IA',
    description: 'Réservé au rôle ADMIN',
  })
  @Patch('agents/:id/toggle')
  toggleAgent(@Param('id') id: string) {
    return this.aiAgentsService.toggleAgent(id);
  }

  @ApiOperation({
    summary: 'Liste des fournisseurs IA configurés (Claude, OpenAI, Azure)',
    description: 'Réservé au rôle ADMIN',
  })
  @Get('providers')
  findAllProviders() {
    return this.aiAgentsService.findAllProviders();
  }

  @ApiOperation({
    summary: 'Change le fournisseur IA actif (sans redéploiement)',
    description:
      'Réservé au rôle ADMIN — seul CLAUDE a une intégration réelle ; choisir un autre fournisseur force le mode dégradé (RM-05).',
  })
  @Patch('providers/active')
  setActiveProvider(@Body() dto: SetActiveAiProviderDto) {
    return this.aiAgentsService.setActiveProvider(dto.provider);
  }
}
