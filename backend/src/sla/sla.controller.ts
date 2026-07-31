import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { SlaService } from './sla.service';
import { UpdateSlaPolicyDto } from './dto/update-sla-policy.dto';

// docs/06-cas-utilisation.md UC-020: Gerer les SLA et priorites
@ApiTags('sla-policies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERVISOR, Role.ADMIN)
@Controller('sla-policies')
export class SlaController {
  constructor(private readonly slaService: SlaService) {}

  @ApiOperation({
    summary: 'Lister les politiques SLA (délai de résolution par priorité)',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Get()
  findAll() {
    return this.slaService.findAllPolicies();
  }

  @ApiOperation({
    summary: "Ajuster le délai de résolution SLA d'une priorité",
    description:
      "Réservé aux rôles SUPERVISOR, ADMIN. S'applique aux tickets créés après la modification",
  })
  @Patch(':priorityId')
  update(
    @Param('priorityId') priorityId: string,
    @Body() dto: UpdateSlaPolicyDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.slaService.updatePolicy(priorityId, dto, requester.userId);
  }
}
