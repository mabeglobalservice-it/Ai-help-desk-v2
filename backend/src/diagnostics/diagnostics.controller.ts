import {
  Body,
  Controller,
  Get,
  Param,
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
import { DiagnosticsService } from './diagnostics.service';
import { AddFeedbackDto } from './dto/add-feedback.dto';
import { StartDiagnosticDto } from './dto/start-diagnostic.dto';
import { ResolveDiagnosticDto } from './dto/resolve-diagnostic.dto';

// docs/11-documentation-api.md §5 : module Diagnostics — soumission
// conversationnelle (Employé, Technicien), historique d'une conversation
// (propriétaire uniquement) et feedback (Technicien).
@ApiTags('diagnostics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  // docs/06-cas-utilisation.md UC-001, docs/09 §3.2 (Agent Help Desk).
  // Même limite de débit que /tickets/ai-diagnose : chaque appel déclenche
  // un appel réel à l'API Anthropic.
  @ApiOperation({
    summary: 'Démarre ou poursuit une conversation de diagnostic',
    description:
      "Réservé aux rôles EMPLOYEE, TECHNICIAN. Sans conversationId, démarre une nouvelle conversation ; avec, le message est traité comme la réponse à la dernière question posée par l'Agent Help Desk.",
  })
  @Roles(Role.EMPLOYEE, Role.TECHNICIAN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  startOrContinue(@Body() dto: StartDiagnosticDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.diagnosticsService.startOrContinue(requester.userId, dto);
  }

  @ApiOperation({
    summary: "Récupère l'historique d'une conversation de diagnostic",
    description: 'Réservé au propriétaire de la conversation',
  })
  @Get(':conversationId')
  getConversation(
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.diagnosticsService.getConversation(
      conversationId,
      requester.userId,
    );
  }

  // docs/06-cas-utilisation.md UC-001 étape 6 : le propriétaire confirme si
  // le problème persiste après les étapes suggérées (US-02/US-03).
  @ApiOperation({
    summary: 'Confirme si le problème persiste après les étapes suggérées',
    description: 'Réservé au propriétaire de la conversation',
  })
  @Roles(Role.EMPLOYEE, Role.TECHNICIAN)
  @Post(':conversationId/resolve')
  resolveConversation(
    @Param('conversationId') conversationId: string,
    @Body() dto: ResolveDiagnosticDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.diagnosticsService.resolveConversation(
      conversationId,
      requester.userId,
      dto,
    );
  }

  @ApiOperation({
    summary: 'Enregistre si le diagnostic a été utile',
    description: 'Réservé au rôle TECHNICIAN',
  })
  @Roles(Role.TECHNICIAN)
  @Post(':conversationId/feedback')
  addFeedback(
    @Param('conversationId') conversationId: string,
    @Body() dto: AddFeedbackDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.diagnosticsService.addFeedback(
      conversationId,
      requester.userId,
      dto,
    );
  }
}
