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
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { DiagnosticsService } from './diagnostics.service';
import { AddFeedbackDto } from './dto/add-feedback.dto';

// docs/11-documentation-api.md §5 : module Diagnostics — historique d'une
// conversation (propriétaire uniquement) et feedback (Technicien).
@ApiTags('diagnostics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

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
