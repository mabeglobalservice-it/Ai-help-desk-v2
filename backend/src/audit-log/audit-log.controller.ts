import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../../generated/prisma/client';
import { AuditLogService } from './audit-log.service';
import { FindAuditLogsQueryDto } from './dto/find-audit-logs-query.dto';

@ApiTags('audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @ApiOperation({
    summary: "Consulter le journal d'audit",
    description:
      'Réservé au rôle ADMIN. Filtrable par acteur, type/id de cible et plage de dates.',
  })
  @Roles(Role.ADMIN)
  @Get()
  findAll(@Query() query: FindAuditLogsQueryDto) {
    return this.auditLogService.findAll(query);
  }
}
