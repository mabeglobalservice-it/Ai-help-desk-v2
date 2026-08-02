import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AiAgentsService } from './ai-agents.service';
import { PrismaService } from '../prisma/prisma.service';

// docs/11-documentation-api.md §6 : administration des agents IA et du
// fournisseur actif.
describe('AiAgentsService', () => {
  let service: AiAgentsService;
  let prisma: {
    aiAgent: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    aiProviderConfig: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      aiAgent: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      aiProviderConfig: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAgentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AiAgentsService);
  });

  describe('toggleAgent', () => {
    it('throws NotFoundException when the agent does not exist', async () => {
      prisma.aiAgent.findUnique.mockResolvedValue(null);

      await expect(service.toggleAgent('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('flips isActive from true to false', async () => {
      prisma.aiAgent.findUnique.mockResolvedValue({
        id: 'agent-1',
        isActive: true,
      });
      prisma.aiAgent.update.mockResolvedValue({
        id: 'agent-1',
        isActive: false,
      });

      const result = await service.toggleAgent('agent-1');

      expect(prisma.aiAgent.update).toHaveBeenCalledWith({
        where: { id: 'agent-1' },
        data: { isActive: false },
      });
      expect(result.isActive).toBe(false);
    });
  });

  describe('setActiveProvider', () => {
    it('throws NotFoundException when the provider does not exist', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue(null);

      await expect(service.setActiveProvider('OPENAI' as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deactivates every other provider and activates the requested one in a single transaction', async () => {
      prisma.aiProviderConfig.findUnique.mockResolvedValue({
        provider: 'OPENAI',
        isActive: false,
      });
      prisma.aiProviderConfig.updateMany.mockResolvedValue({ count: 2 });
      prisma.aiProviderConfig.update.mockResolvedValue({
        provider: 'OPENAI',
        isActive: true,
      });
      prisma.$transaction.mockImplementation((ops) => Promise.all(ops));

      const result = await service.setActiveProvider('OPENAI');

      expect(prisma.aiProviderConfig.updateMany).toHaveBeenCalledWith({
        where: { provider: { not: 'OPENAI' } },
        data: { isActive: false },
      });
      expect(prisma.aiProviderConfig.update).toHaveBeenCalledWith({
        where: { provider: 'OPENAI' },
        data: { isActive: true },
      });
      expect(result).toEqual({ provider: 'OPENAI', isActive: true });
    });
  });
});
