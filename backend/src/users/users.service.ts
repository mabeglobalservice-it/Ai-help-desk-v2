import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Prisma } from '../../generated/prisma/client';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const SALT_ROUNDS = 10;

const USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  role: true,
  entraId: true,
  departmentId: true,
  department: true,
  teamId: true,
  team: true,
  isActive: true,
  canApproveAutomations: true,
  createdAt: true,
} as const;

// docs/06-cas-utilisation.md UC-031: seuls ces champs sont "administratifs"
// (role, rattachement) — email/displayName ne sont pas du ressort de la
// journalisation d'audit au meme titre.
function adminSnapshot(user: {
  role: string;
  isActive: boolean;
  departmentId: string | null;
  teamId: string | null;
  canApproveAutomations: boolean;
}) {
  return {
    role: user.role,
    isActive: user.isActive,
    departmentId: user.departmentId,
    teamId: user.teamId,
    canApproveAutomations: user.canApproveAutomations,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async createUserRecord(dto: CreateUserDto, passwordHash: string) {
    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName,
          role: dto.role,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
        },
        select: USER_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Un utilisateur avec cet email existe déjà',
        );
      }
      throw error;
    }
  }

  private async updateUserRecord(
    id: string,
    dto: UpdateUserDto,
    passwordHash: string | undefined,
  ) {
    try {
      return await this.prisma.user.update({
        where: { id },
        data: {
          email: dto.email,
          passwordHash,
          displayName: dto.displayName,
          role: dto.role,
          departmentId: dto.departmentId,
          teamId: dto.teamId,
          isActive: dto.isActive,
          canApproveAutomations: dto.canApproveAutomations,
        },
        select: USER_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Un utilisateur avec cet email existe déjà',
        );
      }
      throw error;
    }
  }

  async create(dto: CreateUserDto, actorId: string) {
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.createUserRecord(dto, passwordHash);

    await this.auditLogService.record({
      actorId,
      action: 'USER_CREATED',
      targetType: 'User',
      targetId: user.id,
      afterState: {
        email: user.email,
        displayName: user.displayName,
        ...adminSnapshot(user),
      },
    });

    return user;
  }

  async findAll() {
    return this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: USER_SELECT,
    });

    if (!user) {
      throw new NotFoundException(`Utilisateur ${id} introuvable`);
    }

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const before = await this.findOne(id);

    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, SALT_ROUNDS)
      : undefined;

    const updated = await this.updateUserRecord(id, dto, passwordHash);

    await this.auditLogService.record({
      actorId,
      action: 'USER_UPDATED',
      targetType: 'User',
      targetId: id,
      beforeState: adminSnapshot(before),
      afterState: adminSnapshot(updated),
    });

    return updated;
  }
}
