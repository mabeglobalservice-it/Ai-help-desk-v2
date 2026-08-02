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
import { SetCiWarrantyDto } from './dto/set-ci-warranty.dto';
import { SetCiLicenseDto } from './dto/set-ci-license.dto';

const CI_INCLUDE = {
  ciType: true,
  location: true,
  manufacturer: true,
  model: { include: { manufacturer: true } },
  warranty: true,
  license: true,
} as const;

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

// US-27, docs/09-architecture-agents-ia.md §3.6 (Agent Manager) : "alertes
// de tendance (ex. hausse des pannes sur un modele d'appareil)". Purement
// statistique (comptage de tickets par modele sur deux fenetres glissantes),
// pas de modele de machine learning — ce que le doc appelle une "analyse
// predictive" ici se traduit par la detection d'une tendance a la hausse.
const RELIABILITY_WINDOW_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Seuils choisis pour eviter le bruit statistique sur de petits volumes :
// un modele avec 1 seul ticket de plus ne doit pas etre signale "a risque".
const AT_RISK_MIN_RECENT_TICKETS = 3;
const AT_RISK_TICKETS_PER_CI = 1;
const AT_RISK_TREND_MULTIPLIER = 1.5;

// US-23 : fenêtre "à renouveler bientôt" avant l'expiration d'une licence —
// assez large pour laisser le temps d'un cycle d'achat/renouvellement.
const LICENSE_EXPIRING_SOON_DAYS = 60;

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

  // US-27 : "analyse prédictive des pannes récurrentes par modèle
  // d'appareil, afin d'anticiper les remplacements". Compare le nombre de
  // tickets liés à des CI d'un même modèle sur la fenêtre récente vs la
  // fenêtre précédente, et signale les modèles en hausse ou déjà au-dessus
  // du seuil de fiabilité.
  async getModelReliability() {
    const now = new Date();
    const recentStart = new Date(
      now.getTime() - RELIABILITY_WINDOW_DAYS * MS_PER_DAY,
    );
    const previousStart = new Date(
      recentStart.getTime() - RELIABILITY_WINDOW_DAYS * MS_PER_DAY,
    );

    const [models, tickets] = await Promise.all([
      this.prisma.model.findMany({
        include: {
          manufacturer: true,
          configurationItems: { select: { id: true } },
        },
      }),
      this.prisma.ticket.findMany({
        where: {
          createdAt: { gte: previousStart },
          ci: { modelId: { not: null } },
        },
        select: { createdAt: true, ci: { select: { modelId: true } } },
      }),
    ]);

    const recentCounts = new Map<string, number>();
    const previousCounts = new Map<string, number>();
    for (const ticket of tickets) {
      const modelId = ticket.ci?.modelId;
      if (!modelId) continue;
      const bucket =
        ticket.createdAt >= recentStart ? recentCounts : previousCounts;
      bucket.set(modelId, (bucket.get(modelId) ?? 0) + 1);
    }

    return models
      .filter((model) => model.configurationItems.length > 0)
      .map((model) => {
        const ciCount = model.configurationItems.length;
        const recentTicketCount = recentCounts.get(model.id) ?? 0;
        const previousTicketCount = previousCounts.get(model.id) ?? 0;
        const recentTicketsPerCi = recentTicketCount / ciCount;
        const trendPercent =
          previousTicketCount > 0
            ? Math.round(
                ((recentTicketCount - previousTicketCount) /
                  previousTicketCount) *
                  100,
              )
            : null;
        const atRisk =
          recentTicketCount >= AT_RISK_MIN_RECENT_TICKETS &&
          (recentTicketsPerCi >= AT_RISK_TICKETS_PER_CI ||
            (previousTicketCount > 0 &&
              recentTicketCount >=
                previousTicketCount * AT_RISK_TREND_MULTIPLIER));

        return {
          modelId: model.id,
          modelName: model.name,
          manufacturerName: model.manufacturer.name,
          ciCount,
          recentTicketCount,
          previousTicketCount,
          recentTicketsPerCi: Math.round(recentTicketsPerCi * 100) / 100,
          trendPercent,
          atRisk,
        };
      })
      .sort(
        (a, b) =>
          b.recentTicketCount - a.recentTicketCount ||
          b.recentTicketsPerCi - a.recentTicketsPerCi,
      );
  }

  // US-23 : "consulter les licences et leur date d'expiration, afin
  // d'anticiper les renouvellements" — vue agrégée sur tous les CI portant
  // une licence, triée par date d'expiration (la plus urgente en premier).
  async getLicenses() {
    const cis = await this.prisma.configurationItem.findMany({
      where: { licenseId: { not: null } },
      select: {
        id: true,
        name: true,
        inventoryNumber: true,
        ciType: true,
        license: true,
      },
    });

    const now = new Date();
    const soonThreshold = new Date(
      now.getTime() + LICENSE_EXPIRING_SOON_DAYS * MS_PER_DAY,
    );

    return cis
      .filter(
        (ci): ci is typeof ci & { license: NonNullable<typeof ci.license> } =>
          ci.license !== null,
      )
      .map((ci) => {
        const { license, ...ciFields } = ci;
        const status =
          license.expiresAt < now
            ? 'EXPIRED'
            : license.expiresAt <= soonThreshold
              ? 'EXPIRING_SOON'
              : 'VALID';
        const daysUntilExpiration = Math.ceil(
          (license.expiresAt.getTime() - now.getTime()) / MS_PER_DAY,
        );

        return { ci: ciFields, license, status, daysUntilExpiration };
      })
      .sort(
        (a, b) => a.license.expiresAt.getTime() - b.license.expiresAt.getTime(),
      );
  }

  // US-24 : le fabricant/modèle sont des tables normalisées (docs/08 §4.3)
  // pour éviter la duplication ; on les crée à la volée par leur nom plutôt
  // que d'exposer un écran d'administration séparé pour un si petit référentiel.
  private async resolveManufacturerAndModel(
    dto: Pick<CreateConfigurationItemDto, 'manufacturerName' | 'modelName'>,
    existingManufacturerId: string | null,
  ): Promise<{ manufacturerId?: string; modelId?: string }> {
    let manufacturerId = existingManufacturerId ?? undefined;

    if (dto.manufacturerName) {
      const manufacturer = await this.prisma.manufacturer.upsert({
        where: { name: dto.manufacturerName },
        update: {},
        create: { name: dto.manufacturerName },
      });
      manufacturerId = manufacturer.id;
    }

    if (!dto.modelName) {
      return { manufacturerId };
    }

    if (!manufacturerId) {
      throw new BadRequestException(
        'Un modèle nécessite un fabricant : renseignez le fabricant avant le modèle',
      );
    }

    const model = await this.prisma.model.upsert({
      where: { manufacturerId_name: { manufacturerId, name: dto.modelName } },
      update: {},
      create: { manufacturerId, name: dto.modelName },
    });

    return { manufacturerId, modelId: model.id };
  }

  // Garantie stockée comme une entité a part (docs/08 §4.3) plutot que des
  // champs directement sur le CI, pour permettre onDelete: SetNull lors du
  // retrait (clearWarranty) sans avoir a toucher au CI lui-meme.
  private async upsertWarranty(
    existingWarrantyId: string | null,
    dto: SetCiWarrantyDto,
  ): Promise<string> {
    const data = {
      provider: dto.provider,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      referenceNumber: dto.referenceNumber,
      notes: dto.notes,
    };

    if (existingWarrantyId) {
      const updated = await this.prisma.warranty.update({
        where: { id: existingWarrantyId },
        data,
      });
      return updated.id;
    }

    const created = await this.prisma.warranty.create({ data });
    return created.id;
  }

  // US-23 : meme logique que la garantie — cree ou met a jour en place.
  private async upsertLicense(
    existingLicenseId: string | null,
    dto: SetCiLicenseDto,
  ): Promise<string> {
    const data = {
      vendor: dto.vendor,
      expiresAt: new Date(dto.expiresAt),
      purchasedAt: dto.purchasedAt ? new Date(dto.purchasedAt) : null,
      referenceNumber: dto.referenceNumber,
      notes: dto.notes,
    };

    if (existingLicenseId) {
      const updated = await this.prisma.license.update({
        where: { id: existingLicenseId },
        data,
      });
      return updated.id;
    }

    const created = await this.prisma.license.create({ data });
    return created.id;
  }

  private async createRecord(
    dto: CreateConfigurationItemDto,
    manufacturerId: string | undefined,
    modelId: string | undefined,
    warrantyId: string | undefined,
    licenseId: string | undefined,
  ) {
    try {
      return await this.prisma.configurationItem.create({
        data: {
          ciTypeId: dto.ciTypeId,
          name: dto.name,
          inventoryNumber: dto.inventoryNumber,
          serialNumber: dto.serialNumber,
          criticality: dto.criticality,
          status: dto.status,
          manufacturerId,
          modelId,
          warrantyId,
          licenseId,
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

  private async updateRecord(
    id: string,
    dto: UpdateConfigurationItemDto,
    manufacturerId: string | undefined,
    modelId: string | undefined,
    warrantyId: string | null | undefined,
    licenseId: string | null | undefined,
  ) {
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
          manufacturerId,
          modelId,
          warrantyId,
          licenseId,
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
    const { manufacturerId, modelId } = await this.resolveManufacturerAndModel(
      dto,
      null,
    );
    const warrantyId = dto.warranty
      ? await this.upsertWarranty(null, dto.warranty)
      : undefined;
    const licenseId = dto.license
      ? await this.upsertLicense(null, dto.license)
      : undefined;

    const ci = await this.createRecord(
      dto,
      manufacturerId,
      modelId,
      warrantyId,
      licenseId,
    );

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

    let warrantyId: string | null | undefined = before.warrantyId;
    if (dto.warranty) {
      warrantyId = await this.upsertWarranty(before.warrantyId, dto.warranty);
    } else if (dto.clearWarranty && before.warrantyId) {
      await this.prisma.warranty.delete({ where: { id: before.warrantyId } });
      warrantyId = null;
    }

    let licenseId: string | null | undefined = before.licenseId;
    if (dto.license) {
      licenseId = await this.upsertLicense(before.licenseId, dto.license);
    } else if (dto.clearLicense && before.licenseId) {
      await this.prisma.license.delete({ where: { id: before.licenseId } });
      licenseId = null;
    }

    const { manufacturerId, modelId } = await this.resolveManufacturerAndModel(
      dto,
      before.manufacturerId,
    );

    const updated = await this.updateRecord(
      id,
      dto,
      manufacturerId,
      modelId,
      warrantyId,
      licenseId,
    );

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
