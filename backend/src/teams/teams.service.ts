import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

const TEAM_INCLUDE = {
  category: true,
  _count: { select: { members: true } },
} as const;

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.team.findMany({
      include: TEAM_INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: TEAM_INCLUDE,
    });

    if (!team) {
      throw new NotFoundException(`Équipe ${id} introuvable`);
    }

    return team;
  }

  async create(dto: CreateTeamDto) {
    try {
      return await this.prisma.team.create({
        data: { name: dto.name, categoryId: dto.categoryId },
        include: TEAM_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Une équipe avec ce nom existe déjà');
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateTeamDto) {
    await this.findOne(id);

    try {
      return await this.prisma.team.update({
        where: { id },
        data: { name: dto.name, categoryId: dto.categoryId },
        include: TEAM_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Une équipe avec ce nom existe déjà');
      }
      throw error;
    }
  }
}
