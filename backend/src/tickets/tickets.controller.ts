import {
  Body,
  Controller,
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
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';

@ApiTags('tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  // docs/11-documentation-api.md, module Tickets: creation reserved to Employe
  @ApiOperation({
    summary: 'Créer un ticket',
    description: 'Réservé au rôle EMPLOYEE',
  })
  @Roles(Role.EMPLOYEE)
  @Post()
  create(@Body() createTicketDto: CreateTicketDto) {
    return this.ticketsService.create(createTicketDto);
  }

  // Listing/detail: any authenticated role for now (ownership-based
  // filtering from the doc — employe proprietaire / technicien assigne —
  // isn't implemented yet, so it isn't role-restrictable here)
  @ApiOperation({
    summary: 'Lister tous les tickets',
    description:
      'Filtrable par statut, catégorie et priorité (status/categoryId/priorityId)',
  })
  @Get()
  findAll(@Query() query: FindTicketsQueryDto) {
    return this.ticketsService.findAll(query);
  }

  @ApiOperation({ summary: 'Récupérer un ticket par ID' })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ticketsService.findOne(id);
  }

  // Covers status change + reassignment (docs: Technicien assigne, Superviseur)
  @ApiOperation({
    summary: 'Mettre à jour un ticket',
    description: 'Réservé aux rôles TECHNICIAN, SUPERVISOR, ADMIN',
  })
  @Roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTicketDto: UpdateTicketDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.ticketsService.update(id, updateTicketDto, requester.userId);
  }
}
