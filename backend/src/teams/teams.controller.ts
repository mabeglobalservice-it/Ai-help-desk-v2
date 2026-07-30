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
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@ApiTags('teams')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @ApiOperation({
    summary: 'Lister les équipes',
    description:
      'Accessible à tout utilisateur authentifié (utilisé notamment pour assigner un technicien à une équipe)',
  })
  @Get()
  findAll() {
    return this.teamsService.findAll();
  }

  @ApiOperation({
    summary: 'Créer une équipe',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Post()
  create(@Body() dto: CreateTeamDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.teamsService.create(dto, requester.userId);
  }

  @ApiOperation({
    summary: 'Mettre à jour une équipe',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.teamsService.update(id, dto, requester.userId);
  }
}
