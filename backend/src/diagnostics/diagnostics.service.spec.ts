import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosticsService } from './diagnostics.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DiagnosticsService', () => {
  let service: DiagnosticsService;
  let prisma: {
    aiConversation: { findUnique: jest.Mock };
    aiFeedback: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      aiConversation: { findUnique: jest.fn() },
      aiFeedback: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiagnosticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(DiagnosticsService);
  });

  describe('getConversation', () => {
    it('returns the conversation with its messages for the owner', async () => {
      const conversation = {
        id: 'conv-1',
        userId: 'user-1',
        messages: [{ id: 'msg-1', role: 'USER', content: 'Problème' }],
      };
      prisma.aiConversation.findUnique.mockResolvedValue(conversation);

      const result = await service.getConversation('conv-1', 'user-1');

      expect(result).toBe(conversation);
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue(null);

      await expect(
        service.getConversation('conv-missing', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    // docs/11-documentation-api.md §5 : accès réservé au propriétaire de la
    // conversation.
    it('throws ForbiddenException when the requester is not the owner', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [],
      });

      await expect(service.getConversation('conv-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('addFeedback', () => {
    it('attaches feedback to the last agent message', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        messages: [{ id: 'msg-agent-1' }],
      });
      prisma.aiFeedback.create.mockResolvedValue({ id: 'feedback-1' });

      const result = await service.addFeedback('conv-1', 'tech-1', {
        wasHelpful: true,
        comment: 'Bon diagnostic',
      });

      expect(prisma.aiFeedback.create).toHaveBeenCalledWith({
        data: {
          messageId: 'msg-agent-1',
          technicianId: 'tech-1',
          wasHelpful: true,
          comment: 'Bon diagnostic',
        },
      });
      expect(result).toEqual({ id: 'feedback-1' });
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue(null);

      await expect(
        service.addFeedback('conv-missing', 'tech-1', { wasHelpful: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the conversation has no agent message', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        messages: [],
      });

      await expect(
        service.addFeedback('conv-1', 'tech-1', { wasHelpful: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
