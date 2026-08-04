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
import { AdminService } from './admin.service';
import { UpdateSystemSettingsDto } from './dto/update-system-settings.dto';
import { UpdateIntegrationDto } from './dto/update-integration.dto';

// docs/11-documentation-api.md §12 (Module Administration), docs/06-cas-
// utilisation.md UC-030 : reserve a l'Admin.
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @ApiOperation({
    summary: 'Configuration système courante',
    description: 'Réservé au rôle ADMIN',
  })
  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  @ApiOperation({
    summary: 'Modifie la configuration système',
    description: 'Réservé au rôle ADMIN',
  })
  @Patch('settings')
  updateSettings(@Body() dto: UpdateSystemSettingsDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.adminService.updateSettings(dto, requester.userId);
  }

  @ApiOperation({
    summary: 'Statut des intégrations (Teams, Slack, Email, IA, Graph, Intune)',
    description:
      'Réservé au rôle ADMIN — Microsoft Graph et Intune sont déclarés non implémentés (docs/03 §3.4/§3.5)',
  })
  @Get('integrations')
  getIntegrations() {
    return this.adminService.getIntegrations();
  }

  @ApiOperation({
    summary: 'Configure une intégration (activation)',
    description:
      'Réservé au rôle ADMIN — limité à TEAMS/SLACK/EMAIL, les seules intégrations réellement câblées dans ce projet',
  })
  @Patch('integrations/:name')
  updateIntegration(
    @Param('name') name: string,
    @Body() dto: UpdateIntegrationDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.adminService.setIntegrationEnabled(
      name,
      dto.isEnabled,
      requester.userId,
    );
  }
}
