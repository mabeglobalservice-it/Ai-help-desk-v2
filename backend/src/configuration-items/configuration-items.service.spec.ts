import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigurationItemsService } from './configuration-items.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Prisma, Criticality, CiStatus } from '../../generated/prisma/client';

describe('ConfigurationItemsService', () => {
  let service: ConfigurationItemsService;
  let prisma: {
    configurationItem: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
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
});
