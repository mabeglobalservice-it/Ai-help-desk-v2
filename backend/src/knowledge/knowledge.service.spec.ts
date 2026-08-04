import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { KnowledgeArticleStatus, Role } from '../../generated/prisma/client';
import { embed } from './rag/embedding.util';

describe('KnowledgeService', () => {
  let service: KnowledgeService;
  let prisma: {
    documentChunk: {
      findMany: jest.Mock;
      create: jest.Mock;
      deleteMany: jest.Mock;
    };
    ticket: { findUnique: jest.Mock; findMany: jest.Mock };
    knowledgeArticle: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    knowledgeDocument: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
    script: { findMany: jest.Mock };
  };
  let aiService: { summarizeTicketForKnowledgeArticle: jest.Mock };

  beforeEach(async () => {
    prisma = {
      documentChunk: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'chunk-1' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      ticket: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      knowledgeArticle: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      knowledgeDocument: {
        create: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
      },
      script: { findMany: jest.fn().mockResolvedValue([]) },
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
    it('restricts an EMPLOYEE to level-1 chunks only', async () => {
      await service.search('imprimante', {
        userId: 'emp-1',
        role: Role.EMPLOYEE,
      });

      expect(prisma.documentChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { knowledgeLevel: { in: [1] } },
              { knowledgeLevel: 5, ownerId: 'emp-1' },
            ],
          },
        }),
      );
    });

    it('gives a TECHNICIAN levels 1-4 plus their own level-5 notes', async () => {
      await service.search('imprimante', {
        userId: 'tech-1',
        role: Role.TECHNICIAN,
      });

      expect(prisma.documentChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { knowledgeLevel: { in: [1, 2, 3, 4] } },
              { knowledgeLevel: 5, ownerId: 'tech-1' },
            ],
          },
        }),
      );
    });

    it('gives an ADMIN unrestricted access (no where filter)', async () => {
      await service.search('imprimante', {
        userId: 'admin-1',
        role: Role.ADMIN,
      });

      expect(prisma.documentChunk.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    // docs/10-architecture-rag.md §8: seuil de similarité minimal — un
    // chunk sans recouvrement lexical ni similarité cosinus significative
    // est écarté plutôt que forcé dans les résultats.
    it('excludes an unrelated chunk and includes a matching one, hydrated from its origin ticket', async () => {
      prisma.documentChunk.findMany.mockResolvedValue([
        {
          id: 'chunk-match',
          documentId: null,
          ticketId: 'tkt-1',
          knowledgeArticleId: null,
          scriptId: null,
          knowledgeLevel: 3,
          ownerId: null,
          content: 'Imprimante réseau bloquée, redémarrage du spouleur',
          embedding: embed(
            'Imprimante réseau bloquée, redémarrage du spouleur',
          ),
        },
        {
          id: 'chunk-unrelated',
          documentId: null,
          ticketId: 'tkt-2',
          knowledgeArticleId: null,
          scriptId: null,
          knowledgeLevel: 3,
          ownerId: null,
          content: 'Écran bleu, mise à jour du pilote graphique',
          embedding: embed('Écran bleu, mise à jour du pilote graphique'),
        },
      ]);
      prisma.ticket.findMany.mockResolvedValue([
        {
          id: 'tkt-1',
          reference: 'TCK-0001',
          title: 'Imprimante bloquée',
          summary: null,
          resolvedAt: new Date('2026-01-01'),
          category: { name: 'Matériel' },
          priority: { name: 'Moyenne' },
        },
      ]);

      const result = await service.search('imprimante bloquée', {
        userId: 'tech-1',
        role: Role.TECHNICIAN,
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].id).toBe('tkt-1');
      expect(result.results[0].sourceType).toBe('TICKET');
      expect(result.results[0].snippet).toContain('**');
    });

    // docs/10-architecture-rag.md §9 : "signaler explicitement lorsque la
    // confiance de la recherche est faible, plutôt que de forcer une
    // réponse peu fiable".
    it('flags lowConfidence when no chunk clears the relevance threshold', async () => {
      prisma.documentChunk.findMany.mockResolvedValue([
        {
          id: 'chunk-unrelated',
          documentId: null,
          ticketId: 'tkt-2',
          knowledgeArticleId: null,
          scriptId: null,
          knowledgeLevel: 3,
          ownerId: null,
          content: 'Écran bleu, mise à jour du pilote graphique',
          embedding: embed('Écran bleu, mise à jour du pilote graphique'),
        },
      ]);

      const result = await service.search('imprimante bloquée réseau', {
        userId: 'tech-1',
        role: Role.TECHNICIAN,
      });

      expect(result.results).toHaveLength(0);
      expect(result.lowConfidence).toBe(true);
    });

    it('flags lowConfidence for a match that clears the relevance floor but stays weak', async () => {
      prisma.documentChunk.findMany.mockResolvedValue([
        {
          id: 'chunk-weak',
          documentId: null,
          ticketId: 'tkt-1',
          knowledgeArticleId: null,
          scriptId: null,
          knowledgeLevel: 3,
          ownerId: null,
          content: 'Imprimante réseau bloquée',
          embedding: embed('Imprimante réseau bloquée'),
        },
      ]);
      prisma.ticket.findMany.mockResolvedValue([
        {
          id: 'tkt-1',
          reference: 'TCK-0001',
          title: 'Imprimante bloquée',
          summary: null,
          resolvedAt: new Date('2026-01-01'),
          category: { name: 'Matériel' },
          priority: { name: 'Moyenne' },
        },
      ]);

      // Query shares only one significant token ("imprimante") out of three
      // with the chunk — enough to clear RELEVANCE_THRESHOLD (0.2) via
      // partial lexical/cosine overlap, but well short of
      // CONFIDENCE_THRESHOLD (0.4).
      const result = await service.search('imprimante voiture jardin', {
        userId: 'tech-1',
        role: Role.TECHNICIAN,
      });

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].rank).toBeLessThan(0.4);
      expect(result.lowConfidence).toBe(true);
    });

    it('does not flag lowConfidence for a strong, unambiguous match', async () => {
      prisma.documentChunk.findMany.mockResolvedValue([
        {
          id: 'chunk-match',
          documentId: null,
          ticketId: 'tkt-1',
          knowledgeArticleId: null,
          scriptId: null,
          knowledgeLevel: 3,
          ownerId: null,
          content: 'Imprimante réseau bloquée, redémarrage du spouleur',
          embedding: embed(
            'Imprimante réseau bloquée, redémarrage du spouleur',
          ),
        },
      ]);
      prisma.ticket.findMany.mockResolvedValue([
        {
          id: 'tkt-1',
          reference: 'TCK-0001',
          title: 'Imprimante bloquée',
          summary: null,
          resolvedAt: new Date('2026-01-01'),
          category: { name: 'Matériel' },
          priority: { name: 'Moyenne' },
        },
      ]);

      const result = await service.search(
        'imprimante réseau bloquée redémarrage spouleur',
        { userId: 'tech-1', role: Role.TECHNICIAN },
      );

      expect(result.results[0].rank).toBeGreaterThanOrEqual(0.4);
      expect(result.lowConfidence).toBe(false);
    });
  });

  describe('createDocument', () => {
    it('forces level 5 and self-ownership for a TECHNICIAN, ignoring any requested level', async () => {
      await service.createDocument(
        {
          title: 'Mon pense-bête',
          content: 'Contenu suffisant',
          knowledgeLevel: 1,
        },
        { userId: 'tech-1', role: Role.TECHNICIAN },
      );

      expect(prisma.knowledgeDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            knowledgeLevel: 5,
            ownerId: 'tech-1',
          }),
        }),
      );
    });

    it('lets an ADMIN choose level 1, 2 or 4', async () => {
      await service.createDocument(
        {
          title: 'Manuel Cisco',
          content: 'Contenu suffisant',
          knowledgeLevel: 1,
        },
        { userId: 'admin-1', role: Role.ADMIN },
      );

      expect(prisma.knowledgeDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ knowledgeLevel: 1, ownerId: null }),
        }),
      );
    });

    it('rejects an ADMIN specifying level 3 or 5 (auto-indexed elsewhere)', async () => {
      await expect(
        service.createDocument(
          {
            title: 'x',
            content: 'Contenu suffisant',
            knowledgeLevel: 3,
          },
          { userId: 'admin-1', role: Role.ADMIN },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a SUPERVISOR (doc 11 §7 only names Technicien/Admin)', async () => {
      await expect(
        service.createDocument(
          { title: 'x', content: 'Contenu suffisant' },
          { userId: 'sup-1', role: Role.SUPERVISOR },
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getDocument', () => {
    it('throws NotFoundException when the document does not exist', async () => {
      prisma.knowledgeDocument.findUnique.mockResolvedValue(null);

      await expect(
        service.getDocument('missing', { userId: 'u1', role: Role.ADMIN }),
      ).rejects.toThrow(NotFoundException);
    });

    it("forbids a TECHNICIAN from reading another technician's level-5 note", async () => {
      prisma.knowledgeDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        knowledgeLevel: 5,
        ownerId: 'tech-owner',
      });

      await expect(
        service.getDocument('doc-1', {
          userId: 'tech-other',
          role: Role.TECHNICIAN,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the owning technician to read their own level-5 note', async () => {
      prisma.knowledgeDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        knowledgeLevel: 5,
        ownerId: 'tech-owner',
      });

      await expect(
        service.getDocument('doc-1', {
          userId: 'tech-owner',
          role: Role.TECHNICIAN,
        }),
      ).resolves.toEqual(expect.objectContaining({ id: 'doc-1' }));
    });

    it('forbids an EMPLOYEE from reading a level-2 internal document', async () => {
      prisma.knowledgeDocument.findUnique.mockResolvedValue({
        id: 'doc-2',
        knowledgeLevel: 2,
        ownerId: null,
      });

      await expect(
        service.getDocument('doc-2', { userId: 'emp-1', role: Role.EMPLOYEE }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deleteDocument', () => {
    it('allows an ADMIN to delete any document', async () => {
      prisma.knowledgeDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        knowledgeLevel: 5,
        ownerId: 'tech-owner',
      });

      await service.deleteDocument('doc-1', {
        userId: 'admin-1',
        role: Role.ADMIN,
      });

      expect(prisma.knowledgeDocument.delete).toHaveBeenCalledWith({
        where: { id: 'doc-1' },
      });
    });

    it('forbids a technician who does not own the level-5 document', async () => {
      prisma.knowledgeDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        knowledgeLevel: 5,
        ownerId: 'tech-owner',
      });

      await expect(
        service.deleteDocument('doc-1', {
          userId: 'tech-other',
          role: Role.TECHNICIAN,
        }),
      ).rejects.toThrow(ForbiddenException);
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

  // docs/06-cas-utilisation.md UC-015 étape 8 : même circuit de validation
  // qu'un article issu d'un ticket, mais sans ticketId.
  describe('proposeArticleFromAutoResolution', () => {
    it('generates a draft via AiService and creates a PROPOSED article tied to autoResolutionId', async () => {
      aiService.summarizeTicketForKnowledgeArticle.mockResolvedValue({
        title: 'Imprimante bloquée — résolution automatique',
        content: 'Cause probable...\nSolution appliquée...',
        degraded: false,
      });
      prisma.knowledgeArticle.create.mockResolvedValue({ id: 'article-2' });

      const result = await service.proposeArticleFromAutoResolution(
        'autores-1',
        'Imprimante bloquée',
        'Résolution automatique : script exécuté avec succès.',
      );

      expect(aiService.summarizeTicketForKnowledgeArticle).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: 'Imprimante bloquée',
          categoryName: 'Automatisation',
        }),
      );
      expect(prisma.knowledgeArticle.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            autoResolutionId: 'autores-1',
            title: 'Imprimante bloquée — résolution automatique',
          }),
        }),
      );
      expect(result).toEqual({ id: 'article-2' });
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

    it('approves a proposed article, records the approver, and indexes it (level 2)', async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue({
        id: 'article-1',
        status: KnowledgeArticleStatus.PROPOSED,
      });
      prisma.knowledgeArticle.update.mockResolvedValue({
        id: 'article-1',
        title: 'Titre',
        content: 'Contenu',
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
      expect(prisma.documentChunk.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            knowledgeArticleId: 'article-1',
            knowledgeLevel: 2,
          }),
        }),
      );
      expect(result.status).toBe(KnowledgeArticleStatus.APPROVED);
    });

    it('does not index a rejected article', async () => {
      prisma.knowledgeArticle.findUnique.mockResolvedValue({
        id: 'article-1',
        status: KnowledgeArticleStatus.PROPOSED,
      });
      prisma.knowledgeArticle.update.mockResolvedValue({
        id: 'article-1',
        status: KnowledgeArticleStatus.REJECTED,
      });

      await service.decideArticle(
        'article-1',
        KnowledgeArticleStatus.REJECTED,
        'approver-1',
      );

      expect(prisma.documentChunk.create).not.toHaveBeenCalled();
    });
  });
});
