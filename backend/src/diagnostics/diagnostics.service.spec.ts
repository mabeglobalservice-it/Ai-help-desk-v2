import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiagnosticsService } from './diagnostics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AiConversationStatus } from '../../generated/prisma/client';

describe('DiagnosticsService', () => {
  let service: DiagnosticsService;
  let prisma: {
    aiConversation: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    aiMessage: { create: jest.Mock };
    aiFeedback: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let aiService: { converseDiagnostic: jest.Mock };

  beforeEach(async () => {
    prisma = {
      aiConversation: { findUnique: jest.fn(), update: jest.fn() },
      aiMessage: { create: jest.fn() },
      aiFeedback: { create: jest.fn() },
      $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    };
    aiService = { converseDiagnostic: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiagnosticsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService, useValue: aiService },
      ],
    }).compile();

    service = module.get(DiagnosticsService);
  });

  describe('startOrContinue', () => {
    it('delegates to AiService.converseDiagnostic with the requester id', async () => {
      aiService.converseDiagnostic.mockResolvedValue({
        status: 'NEEDS_INFO',
        conversationId: 'conv-1',
        question: 'Quel est le modèle de votre appareil ?',
      });

      const result = await service.startOrContinue('user-1', {
        message: 'Mon ordinateur ne démarre plus',
      });

      expect(aiService.converseDiagnostic).toHaveBeenCalledWith(
        null,
        'user-1',
        'Mon ordinateur ne démarre plus',
      );
      expect(result).toEqual({
        status: 'NEEDS_INFO',
        conversationId: 'conv-1',
        question: 'Quel est le modèle de votre appareil ?',
      });
    });

    it('passes an existing conversationId through', async () => {
      aiService.converseDiagnostic.mockResolvedValue({
        status: 'DIAGNOSED',
        conversationId: 'conv-1',
        diagnosis: {},
      });

      await service.startOrContinue('user-1', {
        message: 'Windows 11',
        conversationId: 'conv-1',
      });

      expect(aiService.converseDiagnostic).toHaveBeenCalledWith(
        'conv-1',
        'user-1',
        'Windows 11',
      );
    });
  });

  describe('resolveConversation', () => {
    it('throws NotFoundException when the conversation does not exist', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveConversation('conv-missing', 'user-1', {
          resolved: true,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the requester is not the owner', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        status: AiConversationStatus.ONGOING,
      });

      await expect(
        service.resolveConversation('conv-1', 'user-2', { resolved: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the conversation is already terminated', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        status: AiConversationStatus.RESOLVED,
      });

      await expect(
        service.resolveConversation('conv-1', 'user-1', { resolved: true }),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks the conversation RESOLVED and logs a message when resolved=true', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        status: AiConversationStatus.ONGOING,
      });

      const result = await service.resolveConversation('conv-1', 'user-1', {
        resolved: true,
      });

      expect(prisma.aiConversation.update).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        data: { status: AiConversationStatus.RESOLVED },
      });
      expect(prisma.aiMessage.create).toHaveBeenCalled();
      expect(result).toEqual({ status: 'RESOLVED' });
    });

    it('leaves the conversation ONGOING and does not update status when resolved=false', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        status: AiConversationStatus.ONGOING,
      });

      const result = await service.resolveConversation('conv-1', 'user-1', {
        resolved: false,
      });

      expect(prisma.aiConversation.update).not.toHaveBeenCalled();
      expect(prisma.aiMessage.create).toHaveBeenCalledWith({
        data: {
          conversationId: 'conv-1',
          role: 'USER',
          content: expect.stringContaining('persiste') as string,
        },
      });
      expect(result).toEqual({ status: 'PERSISTS' });
    });
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
