import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Prisma, TicketStatus } from '../../generated/prisma/client';
import { CreateConfigurationItemDto } from './dto/create-configuration-item.dto';
import { UpdateConfigurationItemDto } from './dto/update-configuration-item.dto';
import { FindConfigurationItemsQueryDto } from './dto/find-configuration-items-query.dto';
import { CreateCiRelationshipDto } from './dto/create-ci-relationship.dto';

const CI_INCLUDE = { ciType: true, location: true } as const;

const RELATIONSHIP_CI_SELECT = {
  id: true,
  name: true,
  inventoryNumber: true,
  criticality: true,
  status: true,
  ciType: true,
} as const;

// docs/06-cas-utilisation.md: un ticket ouvert (pas encore resolu) reflete
// un impact toujours actif sur l'employe qui l'a signale.
const OPEN_TICKET_STATUSES = [
  TicketStatus.NEW,
  TicketStatus.IN_PROGRESS,
  TicketStatus.ESCALATED,
];

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
        // docs/08-schema-base-de-donnees.md §4.3 : dependances directes,
        // dans les deux sens — ce dont ce CI depend (relationshipsAsChild)
        // et ce qui depend de ce CI (relationshipsAsParent).
        relationshipsAsParent: {
          include: { child: { select: RELATIONSHIP_CI_SELECT } },
        },
        relationshipsAsChild: {
          include: { parent: { select: RELATIONSHIP_CI_SELECT } },
        },
      },
    });

    if (!ci) {
      throw new NotFoundException(`Configuration Item ${id} introuvable`);
    }

    return ci;
  }

  // docs/08-schema-base-de-donnees.md §4.3, docs/11-documentation-api.md
  // §9 (GET /inventory/cis/:id/impact) : lie deux CI existants par une
  // relation de dependance (RM-04/UC-022 n'appliquent pas ici — la CMDB
  // elle-meme n'est pas une action sensible).
  async addRelationship(
    parentCiId: string,
    dto: CreateCiRelationshipDto,
    actorId: string,
  ) {
    if (dto.childCiId === parentCiId) {
      throw new BadRequestException(
        'Un Configuration Item ne peut pas dépendre de lui-même',
      );
    }

    const [parent, child] = await Promise.all([
      this.prisma.configurationItem.findUnique({ where: { id: parentCiId } }),
      this.prisma.configurationItem.findUnique({
        where: { id: dto.childCiId },
      }),
    ]);
    if (!parent) {
      throw new NotFoundException(
        `Configuration Item ${parentCiId} introuvable`,
      );
    }
    if (!child) {
      throw new NotFoundException(
        `Configuration Item ${dto.childCiId} introuvable`,
      );
    }

    const relationship = await this.prisma.ciRelationship.create({
      data: {
        parentCiId,
        childCiId: dto.childCiId,
        relationshipType: dto.relationshipType,
      },
      include: { child: { select: RELATIONSHIP_CI_SELECT } },
    });

    await this.auditLogService.record({
      actorId,
      action: 'CI_RELATIONSHIP_ADDED',
      targetType: 'ConfigurationItem',
      targetId: parentCiId,
      afterState: {
        childCiId: dto.childCiId,
        relationshipType: dto.relationshipType,
      },
    });

    return relationship;
  }

  async removeRelationship(
    parentCiId: string,
    relationshipId: string,
    actorId: string,
  ) {
    const relationship = await this.prisma.ciRelationship.findUnique({
      where: { id: relationshipId },
    });
    if (!relationship || relationship.parentCiId !== parentCiId) {
      throw new NotFoundException(`Relation ${relationshipId} introuvable`);
    }

    await this.prisma.ciRelationship.delete({ where: { id: relationshipId } });

    await this.auditLogService.record({
      actorId,
      action: 'CI_RELATIONSHIP_REMOVED',
      targetType: 'ConfigurationItem',
      targetId: parentCiId,
      beforeState: {
        childCiId: relationship.childCiId,
        relationshipType: relationship.relationshipType,
      },
    });

    // Returned (rather than void) so the frontend's generic JSON response
    // parsing doesn't choke on an empty body.
    return { id: relationshipId };
  }

  // docs/08-schema-base-de-donnees.md §4.3 : "un incident sur un serveur
  // permet de savoir immediatement quelles applications en dependent, et
  // donc quels employes/services sont potentiellement impactes — la
  // valeur centrale d'une CMDB en ITSM." Parcours transitif (pas seulement
  // le premier niveau) avec protection anti-cycle.
  async getImpact(id: string) {
    const ci = await this.prisma.configurationItem.findUnique({
      where: { id },
      select: RELATIONSHIP_CI_SELECT,
    });
    if (!ci) {
      throw new NotFoundException(`Configuration Item ${id} introuvable`);
    }

    const impacted = new Map<
      string,
      { ci: typeof ci; relationshipType: string; viaParentId: string }
    >();
    const queue = [id];
    const visited = new Set([id]);

    while (queue.length > 0) {
      const currentId = queue.shift() as string;
      const relationships = await this.prisma.ciRelationship.findMany({
        where: { parentCiId: currentId },
        include: { child: { select: RELATIONSHIP_CI_SELECT } },
      });

      for (const relationship of relationships) {
        if (visited.has(relationship.childCiId)) continue;
        visited.add(relationship.childCiId);
        impacted.set(relationship.childCiId, {
          ci: relationship.child,
          relationshipType: relationship.relationshipType,
          viaParentId: currentId,
        });
        queue.push(relationship.childCiId);
      }
    }

    const impactedCis = [...impacted.values()];
    const impactedIds = [id, ...impactedCis.map((entry) => entry.ci.id)];

    const affectedTickets = await this.prisma.ticket.findMany({
      where: {
        ciId: { in: impactedIds },
        status: { in: OPEN_TICKET_STATUSES },
      },
      select: {
        id: true,
        reference: true,
        title: true,
        status: true,
        ciId: true,
        employee: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { ci, impactedCis, affectedTickets };
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
