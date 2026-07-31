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
import { ConfigurationItemsService } from './configuration-items.service';
import { CreateConfigurationItemDto } from './dto/create-configuration-item.dto';
import { UpdateConfigurationItemDto } from './dto/update-configuration-item.dto';
import { FindConfigurationItemsQueryDto } from './dto/find-configuration-items-query.dto';

@ApiTags('configuration-items')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('configuration-items')
export class ConfigurationItemsController {
  constructor(
    private readonly configurationItemsService: ConfigurationItemsService,
  ) {}

  @ApiOperation({
    summary: 'Lister les Configuration Items (CMDB)',
    description:
      'Accessible à tout utilisateur authentifié (utilisé notamment pour lier un ticket à un CI)',
  })
  @Get()
  findAll(@Query() query: FindConfigurationItemsQueryDto) {
    return this.configurationItemsService.findAll(query);
  }

  @ApiOperation({
    summary: "Détail d'un Configuration Item, avec les tickets qui y sont liés",
    description: 'Accessible à tout utilisateur authentifié',
  })
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.configurationItemsService.findOne(id);
  }

  @ApiOperation({
    summary: 'Créer un Configuration Item',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Post()
  create(@Body() dto: CreateConfigurationItemDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.configurationItemsService.create(dto, requester.userId);
  }

  @ApiOperation({
    summary: 'Mettre à jour un Configuration Item',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateConfigurationItemDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.configurationItemsService.update(id, dto, requester.userId);
  }
}
