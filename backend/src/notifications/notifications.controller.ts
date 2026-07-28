import { Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: "Lister les notifications de l'utilisateur courant" })
  @Get()
  findAll(@Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.notificationsService.findAllForUser(requester.userId);
  }

  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.notificationsService.markAsRead(requester.userId, id);
  }
}
