import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Role } from '../../generated/prisma/client';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';

@ApiTags('ticket-comments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @ApiOperation({ summary: "Lister les commentaires d'un ticket" })
  @Get()
  findAll(@Param('ticketId') ticketId: string) {
    return this.commentsService.findAllForTicket(ticketId);
  }

  @ApiOperation({
    summary: 'Ajouter un commentaire',
    description: "Réservé à l'employé propriétaire, au technicien assigné, ou aux rôles SUPERVISOR/ADMIN",
  })
  @Post()
  create(@Param('ticketId') ticketId: string, @Body() dto: CreateCommentDto, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.commentsService.create(ticketId, requester, dto);
  }
}
