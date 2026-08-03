import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { AutomationService } from './automation.service';
import { CreateScriptDto } from './dto/create-script.dto';
import { CreateAutomationRunDto } from './dto/create-automation-run.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { ProposeAutoResolutionDto } from './dto/propose-auto-resolution.dto';
import { ConfirmAutoResolutionDto } from './dto/confirm-auto-resolution.dto';

// docs/11-documentation-api.md §8 (Module Automation), docs/06-cas-
// utilisation.md UC-014/UC-022, docs/09-architecture-agents-ia.md §3.5.
@ApiTags('automation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('automation')
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @ApiOperation({
    summary: 'Lister les scripts disponibles',
    description: 'Réservé aux rôles TECHNICIAN, ADMIN',
  })
  @Roles(Role.TECHNICIAN, Role.ADMIN)
  @Get('scripts')
  findAllScripts() {
    return this.automationService.findAllScripts();
  }

  @ApiOperation({
    summary: 'Ajouter un script (marqué sensible par défaut)',
    description: 'Réservé au rôle ADMIN',
  })
  @Roles(Role.ADMIN)
  @Post('scripts')
  createScript(@Body() dto: CreateScriptDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.automationService.createScript(dto, requester.userId);
  }

  @ApiOperation({
    summary: 'Suggère un script et une justification pour ce ticket (US-28)',
    description:
      "Réservé au rôle TECHNICIAN — prépare (ne demande ni n'exécute jamais) une action à partir du contexte du ticket, que le technicien reste libre de modifier avant de la proposer via POST /automation/runs",
  })
  @Roles(Role.TECHNICIAN)
  @Get('suggest/:ticketId')
  suggestScriptForTicket(@Param('ticketId') ticketId: string) {
    return this.automationService.suggestScriptForTicket(ticketId);
  }

  @ApiOperation({
    summary: "Demander l'exécution d'un script",
    description:
      'Réservé au rôle TECHNICIAN — déclenche une approbation si le script est sensible (RM-01)',
  })
  @Roles(Role.TECHNICIAN)
  @Post('runs')
  requestRun(@Body() dto: CreateAutomationRunDto, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.automationService.requestRun(dto, requester);
  }

  @ApiOperation({
    summary: "Statut d'une exécution",
    description: 'Demandeur, rôles SUPERVISOR/ADMIN',
  })
  @Roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.ADMIN)
  @Get('runs/:id')
  findRunById(@Param('id') id: string, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.automationService.findRunById(id, requester);
  }

  @ApiOperation({
    summary: 'Liste des approbations en attente',
    description:
      'Réservé aux rôles SUPERVISOR, ADMIN, et TECHNICIAN habilité (UC-022)',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN, Role.TECHNICIAN)
  @Get('approvals/pending')
  findPendingApprovals(@Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.automationService.findPendingApprovals(requester);
  }

  @ApiOperation({
    summary: 'Approuve ou rejette une action sensible',
    description:
      'Réservé aux rôles SUPERVISOR, ADMIN, et TECHNICIAN habilité (UC-022) — un demandeur ne peut pas approuver sa propre demande',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN, Role.TECHNICIAN)
  @Patch('approvals/:id')
  decideApproval(
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string; role: Role };
    return this.automationService.decideApproval(id, dto, requester);
  }

  // docs/06-cas-utilisation.md UC-015 : même point d'entrée (description en
  // langage naturel) et même limite de débit qu'un diagnostic standard
  // (POST /tickets/ai-diagnose), puisque cette route déclenche aussi un
  // appel réel à l'API Anthropic.
  @ApiOperation({
    summary: 'Évalue si un problème peut être résolu automatiquement (UC-015)',
    description:
      "Réservé au rôle EMPLOYEE. Propose une résolution automatique uniquement si un script non sensible correspond avec une confiance >= 95% (RM-03) — ne décide et n'exécute rien.",
  })
  @Roles(Role.EMPLOYEE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auto-resolve')
  proposeAutoResolve(@Body() dto: ProposeAutoResolutionDto) {
    return this.automationService.proposeAutoResolution(dto.description);
  }

  @ApiOperation({
    summary: 'Confirme et exécute une résolution automatique proposée',
    description:
      "Réservé au rôle EMPLOYEE. Revérifie que le script est toujours non sensible (RM-03) ; en cas d'échec, crée un ticket standard avec le contexte de la tentative.",
  })
  @Roles(Role.EMPLOYEE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auto-resolve/confirm')
  confirmAutoResolve(
    @Body() dto: ConfirmAutoResolutionDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.automationService.confirmAutoResolution(dto, requester.userId);
  }
}
