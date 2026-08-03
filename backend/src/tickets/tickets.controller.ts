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
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { AiService } from '../ai/ai.service';
import { TicketsService } from './tickets.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { FindTicketsQueryDto } from './dto/find-tickets-query.dto';
import { RateTicketDto } from './dto/rate-ticket.dto';
import { TechnicianAssistDto } from './dto/technician-assist.dto';
import { AiDiagnoseDto } from '../ai/dto/ai-diagnose.dto';

@ApiTags('tickets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tickets')
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly aiService: AiService,
  ) {}

  // docs/11-documentation-api.md, module Tickets: creation reserved to Employe
  @ApiOperation({
    summary: 'Créer un ticket',
    description: 'Réservé au rôle EMPLOYEE',
  })
  @Roles(Role.EMPLOYEE)
  @Post()
  create(@Body() createTicketDto: CreateTicketDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.ticketsService.create(createTicketDto, requester.userId);
  }

  // docs/11-documentation-api.md §14: rate limiting en priorite sur
  // /diagnostics (cout IA) — ici /tickets/ai-diagnose, chaque appel declenche
  // une requete a l'API Anthropic.
  @ApiOperation({
    summary: 'Analyse une description en langage naturel via IA',
    description:
      'Suggère un titre, une catégorie et une priorité pour aider à préremplir le formulaire de création. Réservé au rôle EMPLOYEE',
  })
  @Roles(Role.EMPLOYEE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ai-diagnose')
  aiDiagnose(@Body() dto: AiDiagnoseDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.aiService.diagnoseTicket(dto.description, requester.userId);
  }

  // RM-04: un employe ne voit que ses propres tickets, un technicien ne voit
  // que ceux qui lui sont assignes; superviseur/admin voient tout.
  @ApiOperation({
    summary: 'Lister tous les tickets',
    description:
      'Filtrable par statut, catégorie, priorité et technicien assigné (status/categoryId/priorityId/technicianId). Résultats bornés par rôle : EMPLOYEE ne voit que ses tickets, TECHNICIAN que ceux qui lui sont assignés (RM-04)',
  })
  @Get()
  findAll(@Query() query: FindTicketsQueryDto, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.ticketsService.findAll(query, requester);
  }

  @ApiOperation({
    summary: 'Récupérer un ticket par ID',
    description:
      'Réservé au propriétaire pour un EMPLOYEE ou au technicien assigné pour un TECHNICIAN (RM-04)',
  })
  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    const requester = req.user as { userId: string; role: Role };
    return this.ticketsService.findOne(id, requester);
  }

  @ApiOperation({
    summary: "Évalue la résolution d'un ticket (UC-004)",
    description:
      "Réservé à l'employé propriétaire, uniquement une fois le ticket résolu",
  })
  @Roles(Role.EMPLOYEE)
  @Post(':id/rate')
  rate(
    @Param('id') id: string,
    @Body() dto: RateTicketDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.ticketsService.rate(id, requester.userId, dto);
  }

  @ApiOperation({
    summary: 'Suggère un technicien à assigner à ce ticket',
    description:
      "Cherche parmi les techniciens de l'équipe correspondant à la catégorie du ticket (ou parmi tous les techniciens actifs si aucune équipe ne correspond) celui ayant le moins de tickets ouverts. Réservé aux rôles SUPERVISOR, ADMIN",
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Post(':id/suggest-technician')
  suggestTechnician(@Param('id') id: string) {
    return this.ticketsService.suggestTechnician(id);
  }

  // docs/09-architecture-agents-ia.md §3.3 (Agent Technicien) : reserve au
  // technicien assigne a ce ticket (RM-04) — chaque appel declenche une
  // requete reelle a l'API Anthropic, meme limite de debit que les autres
  // endpoints IA.
  @ApiOperation({
    summary: "Demande une explication à l'Agent Technicien",
    description:
      "Explique une panne, une commande ou un script à partir du contexte du ticket et de l'historique CMDB de l'actif concerné ; peut suggérer un script à titre indicatif, jamais exécuté. Réservé au technicien assigné à ce ticket",
  })
  @Roles(Role.TECHNICIAN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/assist')
  assistTechnician(
    @Param('id') id: string,
    @Body() dto: TechnicianAssistDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string; role: Role };
    return this.ticketsService.assistTechnician(id, requester, dto.question);
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
    const requester = req.user as { userId: string; role: Role };
    return this.ticketsService.update(
      id,
      updateTicketDto,
      requester.userId,
      requester.role,
    );
  }
}
