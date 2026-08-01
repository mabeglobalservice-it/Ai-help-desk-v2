import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { KnowledgeArticleStatus } from '../../generated/prisma/client';

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let prisma: {
    $queryRaw: jest.Mock;
    ticket: { findUnique: jest.Mock };
    knowledgeArticle: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let aiService: { summarizeTicketForKnowledgeArticle: jest.Mock };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      ticket: { findUnique: jest.fn() },
      knowledgeArticle: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    aiService = { summarizeTicketForKnowledgeArticle: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KnowledgeService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService, useValue: aiService },
      ],
    }).compile();

    service = module.get(KnowledgeService);
  });

  describe('search', () => {
    it('delegates to a raw SQL query unioning resolved tickets and approved articles', async () => {
      await service.search('imprimante');
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('proposeArticleFromTicket', () => {
    it('returns null when the ticket does not exist', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);

      const result = await service.proposeArticleFromTicket('missing');

      expect(result).toBeNull();
      expect(
        aiService.summarizeTicketForKnowledgeArticle,
      ).not.toHaveBeenCalled();
    });

    it('generates a draft via AiService and creates a PROPOSED article', async () => {
      prisma.ticket.findUnique.mockResolvedValue({
        id: 'tkt-1',
        title: 'Imprimante bloquée',
        summary: 'Les travaux ne sortent plus',
        resolutionNote: 'Redémarrage du spouleur',
        category: { name: 'Matériel' },
      });
      aiService.summarizeTicketForKnowledgeArticle.mockResolvedValue({
        title: 'Imprimante bloquée — spouleur figé',
        content: 'Cause probable...\nSolution appliquée...',
        degraded: false,
      });
      prisma.knowledgeArticle.create.mockResolvedValue({ id: 'article-1' });

      const result = await service.proposeArticleFromTicket('tkt-1');

      expect(aiService.summarizeTicketForKnowledgeArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Imprimante bloquée',
          categoryName: 'Matériel',
        }),
      );
      expect(prisma.knowledgeArticle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ticketId: 'tkt-1',
            title: 'Imprimante bloquée — spouleur figé',
          }),
        }),
      );
      expect(result).toEqual({ id: 'article-1' });
    });
  });

  describe('decideArticle', () => {
    it('rejects a decision value other than APPROVED/REJECTED', async () => {
      await expect(
        service.decideArticle(
          'article-1',
          KnowledgeArticleStatus.PROPOSED,
          'approver-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the article does not exist', async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue(null);

      await expect(
        service.decideArticle(
          'missing',
          KnowledgeArticleStatus.APPROVED,
          'approver-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects deciding an article that was already processed', async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue({
        id: 'article-1',
        status: KnowledgeArticleStatus.APPROVED,
      });

      await expect(
        service.decideArticle(
          'article-1',
          KnowledgeArticleStatus.APPROVED,
          'approver-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('approves a proposed article and records the approver', async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue({
        id: 'article-1',
        status: KnowledgeArticleStatus.PROPOSED,
      });
      prisma.knowledgeArticle.update.mockResolvedValue({
        id: 'article-1',
        status: KnowledgeArticleStatus.APPROVED,
        approvedById: 'approver-1',
      });

      const result = await service.decideArticle(
        'article-1',
        KnowledgeArticleStatus.APPROVED,
        'approver-1',
      );

      expect(prisma.knowledgeArticle.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: KnowledgeArticleStatus.APPROVED,
            approvedById: 'approver-1',
          }),
        }),
      );
      expect(result.status).toBe(KnowledgeArticleStatus.APPROVED);
    });
  });
});
