import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigurationItemsService } from './configuration-items.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  Prisma,
  Criticality,
  CiStatus,
  RelationshipType,
  TicketStatus,
} from '../../generated/prisma/client';

describe('ConfigurationItemsService', () => {
  let service: ConfigurationItemsService;
  let prisma: {
    configurationItem: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    ciRelationship: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
    ticket: { findMany: jest.Mock };
  };
  let auditLogService: { record: jest.Mock };

  beforeEach(async () => {
    prisma = {
      configurationItem: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      ciRelationship: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      ticket: { findMany: jest.fn() },
    };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConfigurationItemsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(ConfigurationItemsService);
  });

  describe('findOne', () => {
    it('throws NotFoundException when the CI does not exist', async () => {
      prisma.configurationItem.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('includes the linked tickets for impact assessment', async () => {
      prisma.configurationItem.findUnique.mockResolvedValue({
        id: 'ci-1',
        name: 'SRV-01',
        tickets: [{ id: 'tkt-1', reference: 'TCK-2026-0001' }],
      });

      const result = await service.findOne('ci-1');

      expect(prisma.configurationItem.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'ci-1' },
          include: expect.objectContaining({
            tickets: expect.anything(),
          }),
        }),
      );
      expect(result.tickets).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('wraps a unique-constraint violation on inventoryNumber into ConflictException', async () => {
      prisma.configurationItem.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '7.9.1',
        }),
      );

      await expect(
        service.create(
          {
            ciTypeId: 'type-1',
            name: 'SRV-01',
            inventoryNumber: 'INV-001',
          },
          'actor-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the CI and records an audit log entry', async () => {
      prisma.configurationItem.create.mockResolvedValue({
        id: 'ci-1',
        name: 'SRV-01',
        inventoryNumber: 'INV-001',
        status: CiStatus.ACTIVE,
        criticality: Criticality.MEDIUM,
      });

      const result = await service.create(
        { ciTypeId: 'type-1', name: 'SRV-01', inventoryNumber: 'INV-001' },
        'actor-1',
      );

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-1',
          action: 'CI_CREATED',
          targetType: 'ConfigurationItem',
          targetId: 'ci-1',
        }),
      );
      expect(result.id).toBe('ci-1');
    });
  });

  describe('update', () => {
    it('records before/after state in the audit log', async () => {
      prisma.configurationItem.findUnique.mockResolvedValue({
        id: 'ci-1',
        name: 'SRV-01',
        inventoryNumber: 'INV-001',
        status: CiStatus.ACTIVE,
        criticality: Criticality.MEDIUM,
        tickets: [],
      });
      prisma.configurationItem.update.mockResolvedValue({
        id: 'ci-1',
        name: 'SRV-01',
        inventoryNumber: 'INV-001',
        status: CiStatus.IN_REPAIR,
        criticality: Criticality.MEDIUM,
      });

      await service.update('ci-1', { status: CiStatus.IN_REPAIR }, 'actor-1');

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CI_UPDATED',
          beforeState: expect.objectContaining({ status: CiStatus.ACTIVE }),
          afterState: expect.objectContaining({ status: CiStatus.IN_REPAIR }),
        }),
      );
    });
  });

  // docs/08-schema-base-de-donnees.md §4.3
  describe('addRelationship', () => {
    it('rejects a CI depending on itself', async () => {
      await expect(
        service.addRelationship(
          'ci-1',
          { childCiId: 'ci-1', relationshipType: RelationshipType.RUNS_ON },
          'actor-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the parent CI does not exist', async () => {
      prisma.configurationItem.findUnique
        .mockResolvedValueOnce(null) // parent
        .mockResolvedValueOnce({ id: 'ci-2' }); // child

      await expect(
        service.addRelationship(
          'ci-1',
          { childCiId: 'ci-2', relationshipType: RelationshipType.RUNS_ON },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the child CI does not exist', async () => {
      prisma.configurationItem.findUnique
        .mockResolvedValueOnce({ id: 'ci-1' }) // parent
        .mockResolvedValueOnce(null); // child

      await expect(
        service.addRelationship(
          'ci-1',
          { childCiId: 'ci-2', relationshipType: RelationshipType.RUNS_ON },
          'actor-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates the relationship and records an audit log entry', async () => {
      prisma.configurationItem.findUnique
        .mockResolvedValueOnce({ id: 'ci-1' })
        .mockResolvedValueOnce({ id: 'ci-2' });
      prisma.ciRelationship.create.mockResolvedValue({
        id: 'rel-1',
        parentCiId: 'ci-1',
        childCiId: 'ci-2',
        relationshipType: RelationshipType.RUNS_ON,
      });

      const result = await service.addRelationship(
        'ci-1',
        { childCiId: 'ci-2', relationshipType: RelationshipType.RUNS_ON },
        'actor-1',
      );

      expect(prisma.ciRelationship.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            parentCiId: 'ci-1',
            childCiId: 'ci-2',
            relationshipType: RelationshipType.RUNS_ON,
          },
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CI_RELATIONSHIP_ADDED',
          targetId: 'ci-1',
        }),
      );
      expect(result.id).toBe('rel-1');
    });
  });

  describe('removeRelationship', () => {
    it('throws NotFoundException when the relationship does not exist', async () => {
      prisma.ciRelationship.findUnique.mockResolvedValue(null);

      await expect(
        service.removeRelationship('ci-1', 'rel-missing', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws NotFoundException when the relationship doesn't belong to this parent", async () => {
      prisma.ciRelationship.findUnique.mockResolvedValue({
        id: 'rel-1',
        parentCiId: 'ci-other',
        childCiId: 'ci-2',
      });

      await expect(
        service.removeRelationship('ci-1', 'rel-1', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deletes the relationship and records an audit log entry', async () => {
      prisma.ciRelationship.findUnique.mockResolvedValue({
        id: 'rel-1',
        parentCiId: 'ci-1',
        childCiId: 'ci-2',
        relationshipType: RelationshipType.RUNS_ON,
      });

      await service.removeRelationship('ci-1', 'rel-1', 'actor-1');

      expect(prisma.ciRelationship.delete).toHaveBeenCalledWith({
        where: { id: 'rel-1' },
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CI_RELATIONSHIP_REMOVED',
          targetId: 'ci-1',
        }),
      );
    });
  });

  describe('getImpact', () => {
    it('throws NotFoundException when the CI does not exist', async () => {
      prisma.configurationItem.findUnique.mockResolvedValue(null);

      await expect(service.getImpact('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('walks the dependency chain transitively and lists affected open tickets', async () => {
      prisma.configurationItem.findUnique.mockResolvedValue({
        id: 'ci-1',
        name: 'Serveur applicatif',
      });
      prisma.ciRelationship.findMany
        .mockResolvedValueOnce([
          {
            childCiId: 'ci-2',
            relationshipType: RelationshipType.RUNS_ON,
            child: { id: 'ci-2', name: 'Application RH' },
          },
        ])
        .mockResolvedValueOnce([
          {
            childCiId: 'ci-3',
            relationshipType: RelationshipType.DEPENDS_ON,
            child: { id: 'ci-3', name: 'Service de paie' },
          },
        ])
        .mockResolvedValueOnce([]); // ci-3 has no further dependents
      prisma.ticket.findMany.mockResolvedValue([
        {
          id: 'tkt-1',
          reference: 'TCK-2026-0001',
          ciId: 'ci-2',
          status: TicketStatus.IN_PROGRESS,
          employee: { id: 'emp-1', displayName: 'Nathalie' },
        },
      ]);

      const result = await service.getImpact('ci-1');

      expect(result.impactedCis).toHaveLength(2);
      expect(result.impactedCis.map((entry) => entry.ci.id)).toEqual([
        'ci-2',
        'ci-3',
      ]);
      expect(prisma.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ciId: { in: ['ci-1', 'ci-2', 'ci-3'] },
          }),
        }),
      );
      expect(result.affectedTickets).toHaveLength(1);
    });

    it('does not loop forever when the dependency graph has a cycle', async () => {
      prisma.configurationItem.findUnique.mockResolvedValue({
        id: 'ci-1',
        name: 'CI A',
      });
      prisma.ciRelationship.findMany
        .mockResolvedValueOnce([
          {
            childCiId: 'ci-2',
            relationshipType: RelationshipType.CONNECTS_TO,
            child: { id: 'ci-2', name: 'CI B' },
          },
        ])
        .mockResolvedValueOnce([
          {
            // cycle back to ci-1, already visited — must not requeue it
            childCiId: 'ci-1',
            relationshipType: RelationshipType.CONNECTS_TO,
            child: { id: 'ci-1', name: 'CI A' },
          },
        ]);
      prisma.ticket.findMany.mockResolvedValue([]);

      const result = await service.getImpact('ci-1');

      expect(result.impactedCis).toHaveLength(1);
      expect(prisma.ciRelationship.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
