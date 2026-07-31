import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Prisma } from '../../generated/prisma/client';
import { CreateConfigurationItemDto } from './dto/create-configuration-item.dto';
import { UpdateConfigurationItemDto } from './dto/update-configuration-item.dto';
import { FindConfigurationItemsQueryDto } from './dto/find-configuration-items-query.dto';

const CI_INCLUDE = { ciType: true, location: true } as const;

// docs/08-schema-base-de-donnees.md §4.3 (CMDB), docs/05-user-stories.md
// US-22/US-24: gestion des Configuration Items (CI) et de leur lien aux
// tickets, pour connaitre les actifs concernes par un incident.
@Injectable()
export class ConfigurationItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(query: FindConfigurationItemsQueryDto) {
    return this.prisma.configurationItem.findMany({
      where: {
        ciTypeId: query.ciTypeId,
        criticality: query.criticality,
        status: query.status,
      },
      include: CI_INCLUDE,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const ci = await this.prisma.configurationItem.findUnique({
      where: { id },
      include: {
        ...CI_INCLUDE,
        // Valeur centrale d'une CMDB : savoir quels tickets (donc quels
        // incidents) concernent cet actif, pour evaluer l'impact.
        tickets: {
          select: {
            id: true,
            reference: true,
            title: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!ci) {
      throw new NotFoundException(`Configuration Item ${id} introuvable`);
    }

    return ci;
  }

  private async createRecord(dto: CreateConfigurationItemDto) {
    try {
      return await this.prisma.configurationItem.create({
        data: {
          ciTypeId: dto.ciTypeId,
          name: dto.name,
          inventoryNumber: dto.inventoryNumber,
          serialNumber: dto.serialNumber,
          criticality: dto.criticality,
          status: dto.status,
        },
        include: CI_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          "Un Configuration Item avec ce numéro d'inventaire existe déjà",
        );
      }
      throw error;
    }
  }

  private async updateRecord(id: string, dto: UpdateConfigurationItemDto) {
    try {
      return await this.prisma.configurationItem.update({
        where: { id },
        data: {
          ciTypeId: dto.ciTypeId,
          name: dto.name,
          inventoryNumber: dto.inventoryNumber,
          serialNumber: dto.serialNumber,
          criticality: dto.criticality,
          status: dto.status,
        },
        include: CI_INCLUDE,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          "Un Configuration Item avec ce numéro d'inventaire existe déjà",
        );
      }
      throw error;
    }
  }

  async create(dto: CreateConfigurationItemDto, actorId: string) {
    const ci = await this.createRecord(dto);

    await this.auditLogService.record({
      actorId,
      action: 'CI_CREATED',
      targetType: 'ConfigurationItem',
      targetId: ci.id,
      afterState: {
        name: ci.name,
        inventoryNumber: ci.inventoryNumber,
        status: ci.status,
        criticality: ci.criticality,
      },
    });

    return ci;
  }

  async update(id: string, dto: UpdateConfigurationItemDto, actorId: string) {
    const before = await this.findOne(id);
    const updated = await this.updateRecord(id, dto);

    await this.auditLogService.record({
      actorId,
      action: 'CI_UPDATED',
      targetType: 'ConfigurationItem',
      targetId: id,
      beforeState: {
        name: before.name,
        inventoryNumber: before.inventoryNumber,
        status: before.status,
        criticality: before.criticality,
      },
      afterState: {
        name: updated.name,
        inventoryNumber: updated.inventoryNumber,
        status: updated.status,
        criticality: updated.criticality,
      },
    });

    return updated;
  }
}
