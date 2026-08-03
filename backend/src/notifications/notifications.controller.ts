import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../../generated/prisma/client';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({
    summary: "Lister les notifications de l'utilisateur courant",
  })
  @Get()
  findAll(@Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.notificationsService.findAllForUser(requester.userId);
  }

  // docs/11-documentation-api.md §10 : déclarée avant ':id/read' n'a pas
  // d'importance ici (segments littéraux distincts), mais placée en premier
  // par lisibilité — la liste des modèles précède l'action sur une instance.
  @ApiOperation({
    summary: 'Liste des modèles de notification',
    description: 'Réservé au rôle ADMIN',
  })
  @Roles(Role.ADMIN)
  @Get('templates')
  getTemplates() {
    return this.notificationsService.getTemplates();
  }

  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.notificationsService.markAsRead(requester.userId, id);
  }
}
