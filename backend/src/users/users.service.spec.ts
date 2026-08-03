import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { Role } from '../../generated/prisma/client';

describe('UsersService', () => {
  let service: UsersService;
  let prisma: {
    user: { findUnique: jest.Mock };
    ticketCategory: { findMany: jest.Mock };
    technicianSpecialty: { deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let auditLogService: { record: jest.Mock };

  const technician = {
    id: 'tech-1',
    role: Role.TECHNICIAN,
    specialties: [{ categoryId: 'cat-reseau' }],
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      ticketCategory: { findMany: jest.fn() },
      technicianSpecialty: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn().mockImplementation((ops) => Promise.all(ops)),
    };
    auditLogService = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  // docs/06-cas-utilisation.md UC-031 étape 3, docs/05-user-stories.md US-13
  describe('updateSpecialties', () => {
    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateSpecialties('missing', ['cat-reseau'], 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a non-TECHNICIAN target', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...technician,
        role: Role.EMPLOYEE,
      });

      await expect(
        service.updateSpecialties('emp-1', ['cat-reseau'], 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown category id', async () => {
      prisma.user.findUnique.mockResolvedValue(technician);
      prisma.ticketCategory.findMany.mockResolvedValue([]);

      await expect(
        service.updateSpecialties('tech-1', ['cat-missing'], 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('replaces the full specialty set and audit-logs before/after category ids', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(technician)
        .mockResolvedValueOnce({
          ...technician,
          specialties: [
            { categoryId: 'cat-materiel' },
            { categoryId: 'cat-logiciel' },
          ],
        });
      prisma.ticketCategory.findMany.mockResolvedValue([
        { id: 'cat-materiel' },
        { id: 'cat-logiciel' },
      ]);

      const result = await service.updateSpecialties(
        'tech-1',
        ['cat-materiel', 'cat-logiciel'],
        'admin-1',
      );

      expect(prisma.technicianSpecialty.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'tech-1' },
      });
      expect(prisma.technicianSpecialty.createMany).toHaveBeenCalledWith({
        data: [
          { userId: 'tech-1', categoryId: 'cat-materiel' },
          { userId: 'tech-1', categoryId: 'cat-logiciel' },
        ],
      });
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'USER_SPECIALTIES_UPDATED',
          targetId: 'tech-1',
          beforeState: { categoryIds: ['cat-reseau'] },
          afterState: { categoryIds: ['cat-materiel', 'cat-logiciel'] },
        }),
      );
      expect(result.specialties).toEqual([
        { categoryId: 'cat-materiel' },
        { categoryId: 'cat-logiciel' },
      ]);
    });

    it('clears all specialties when given an empty array', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(technician)
        .mockResolvedValueOnce({ ...technician, specialties: [] });

      await service.updateSpecialties('tech-1', [], 'admin-1');

      expect(prisma.ticketCategory.findMany).not.toHaveBeenCalled();
      expect(prisma.technicianSpecialty.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'tech-1' },
      });
      expect(prisma.technicianSpecialty.createMany).toHaveBeenCalledWith({
        data: [],
      });
    });
  });
});
