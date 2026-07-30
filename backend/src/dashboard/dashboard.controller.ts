import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { DashboardService } from './dashboard.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats-query.dto';
import { ExportDashboardQueryDto } from './dto/export-dashboard-query.dto';

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

  @ApiOperation({
    summary: 'Exporter le rapport du tableau de bord (BR-11)',
    description:
      'Réservé aux rôles SUPERVISOR, ADMIN. Mêmes filtres de dates que /dashboard/stats, format=csv ou pdf.',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get('export')
  async export(@Query() query: ExportDashboardQueryDto, @Res() res: Response) {
    const { format, ...statsQuery } = query;
    const { filename, contentType, body } =
      await this.dashboardService.exportReport(statsQuery, format);

    // Not using passthrough: Nest's default response handling would
    // JSON-serialize a Buffer body (PDF) instead of sending raw bytes.
    // res.send() handles both string (CSV) and Buffer (PDF) correctly.
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(body);
  }
}
