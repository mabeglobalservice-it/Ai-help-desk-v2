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
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSpecialtiesDto } from './dto/update-specialties.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({
    summary: 'Créer un utilisateur',
    description: 'Réservé au rôle ADMIN',
  })
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() createUserDto: CreateUserDto, @Req() req: Request) {
    const requester = req.user as { userId: string };
    return this.usersService.create(createUserDto, requester.userId);
  }

  @ApiOperation({
    summary: 'Lister tous les utilisateurs',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @ApiOperation({
    summary: 'Récupérer un utilisateur par ID',
    description: 'Réservé aux rôles SUPERVISOR, ADMIN',
  })
  @Roles(Role.SUPERVISOR, Role.ADMIN)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @ApiOperation({
    summary: 'Mettre à jour un utilisateur',
    description: 'Réservé au rôle ADMIN',
  })
  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.usersService.update(id, updateUserDto, requester.userId);
  }

  @ApiOperation({
    summary: 'Associe un technicien à une ou plusieurs spécialités',
    description: 'Réservé au rôle ADMIN (UC-031)',
  })
  @Roles(Role.ADMIN)
  @Patch(':id/specialties')
  updateSpecialties(
    @Param('id') id: string,
    @Body() dto: UpdateSpecialtiesDto,
    @Req() req: Request,
  ) {
    const requester = req.user as { userId: string };
    return this.usersService.updateSpecialties(
      id,
      dto.categoryIds,
      requester.userId,
    );
  }
}
