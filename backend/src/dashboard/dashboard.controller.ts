import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { DashboardService } from './dashboard.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats-query.dto';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @ApiOperation({
    summary: 'Statistiques du tableau de bord',
    description:
      'Réservé aux rôles SUPERVISOR, ADMIN. Filtrable par plage de dates de création (from/to).',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get('stats')
  getStats(@Query() query: DashboardStatsQueryDto) {
    return this.dashboardService.getStats(query);
  }
}
