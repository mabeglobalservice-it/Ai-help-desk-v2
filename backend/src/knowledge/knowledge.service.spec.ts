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

// docs/06-cas-utilisation.md RM-05 : ce fichier teste KnowledgeService avec
// le vectoriseur en mode dégradé (hashing trick) — aucune clé Voyage AI
// n'est configurée dans l'environnement de test, embed() y retombe donc
// systématiquement sur le repli local. La couverture spécifique à Voyage AI
// (succès, échec, absence de clé) vit dans
// src/knowledge/rag/embedding.util.spec.ts.

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
    searchLog: { create: jest.Mock; count: jest.Mock; aggregate: jest.Mock };
    searchLogResult: {
      aggregate: jest.Mock;
      groupBy: jest.Mock;
      findMany: jest.Mock;
    };
    aiMessage: { aggregate: jest.Mock };
  };
  let aiService: {
    summarizeTicketForKnowledgeArticle: jest.Mock;
    detectContradictions: jest.Mock;
  };

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
      searchLog: {
        create: jest.fn().mockResolvedValue({ id: 'search-log-1' }),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _avg: { latencyMs: null } }),
      },
      searchLogResult: {
        aggregate: jest.fn().mockResolvedValue({ _avg: { rank: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiMessage: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { tokenCost: null }, _count: 0 }),
      },
    };
    aiService = {
      summarizeTicketForKnowledgeArticle: jest.fn(),
      detectContradictions: jest.fn().mockResolvedValue([]),
    };

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
          embedding: await embed(
            'Imprimante réseau bloquée, redémarrage du spouleur',
          ),
          embeddingProvider: 'HASHING',
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
          embedding: await embed('Écran bleu, mise à jour du pilote graphique'),
          embeddingProvider: 'HASHING',
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
          embedding: await embed('Écran bleu, mise à jour du pilote graphique'),
          embeddingProvider: 'HASHING',
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
          embedding: await embed('Imprimante réseau bloquée'),
          embeddingProvider: 'HASHING',
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
          embedding: await embed(
            'Imprimante réseau bloquée, redémarrage du spouleur',
          ),
          embeddingProvider: 'HASHING',
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

    // rag/embedding.util.ts : un chunk indexé via Voyage AI (1024 dims) et
    // une requête embeddée via le hashing trick (256 dims, mode dégradé
    // sans clé) ne sont jamais comparables par similarité cosinus — sans ce
    // garde-fou, comparer des vecteurs de tailles différentes produirait un
    // score sans signification (voire un plantage selon l'implémentation).
    it('never compares a chunk from a different embedding provider by cosine similarity, only lexical overlap', async () => {
      const voyageVector = new Array(1024).fill(0);
      voyageVector[0] = 1;
      prisma.documentChunk.findMany.mockResolvedValue([
        {
          id: 'chunk-voyage',
          documentId: null,
          ticketId: 'tkt-1',
          knowledgeArticleId: null,
          scriptId: null,
          knowledgeLevel: 3,
          ownerId: null,
          content: 'Imprimante réseau bloquée, redémarrage du spouleur',
          embedding: voyageVector,
          embeddingProvider: 'VOYAGE',
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

      // No VOYAGE_API_KEY configured in this test env, so the query is
      // embedded via the hashing trick (provider HASHING) — mismatched
      // against the chunk above (provider VOYAGE).
      const result = await service.search(
        'imprimante réseau bloquée redémarrage spouleur',
        { userId: 'tech-1', role: Role.TECHNICIAN },
      );

      // Strong lexical overlap alone (LEXICAL_WEIGHT 0.4, full match) still
      // clears RELEVANCE_THRESHOLD (0.2), but the cosine contribution must
      // be exactly 0 — not a value computed from two incompatible vectors.
      expect(result.results).toHaveLength(1);
      expect(result.results[0].rank).toBeCloseTo(0.4, 5);
    });

    // docs/10-architecture-rag.md §9 (Agent Documentation).
    describe('contradiction detection', () => {
      const query = 'imprimante réseau bloquée redémarrage spouleur';

      async function seedTwoMatchingSources() {
        const content = 'Imprimante réseau bloquée, redémarrage du spouleur';
        prisma.documentChunk.findMany.mockResolvedValue([
          {
            id: 'chunk-ticket',
            documentId: null,
            ticketId: 'tkt-1',
            knowledgeArticleId: null,
            scriptId: null,
            knowledgeLevel: 3,
            ownerId: null,
            content,
            embedding: await embed(content),
            embeddingProvider: 'HASHING',
          },
          {
            id: 'chunk-document',
            documentId: 'doc-1',
            ticketId: null,
            knowledgeArticleId: null,
            scriptId: null,
            knowledgeLevel: 2,
            ownerId: null,
            content,
            embedding: await embed(content),
            embeddingProvider: 'HASHING',
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
        prisma.knowledgeDocument.findMany.mockResolvedValue([
          { id: 'doc-1', title: 'Procédure imprimante réseau' },
        ]);
      }

      it('does not call AiService.detectContradictions when fewer than 2 results are found', async () => {
        await service.search(query, {
          userId: 'tech-1',
          role: Role.TECHNICIAN,
        });

        expect(aiService.detectContradictions).not.toHaveBeenCalled();
      });

      it('calls AiService.detectContradictions with the full chunk content of the top results and returns its flags', async () => {
        await seedTwoMatchingSources();
        aiService.detectContradictions.mockResolvedValue([
          {
            sourceIds: ['tkt-1', 'doc-1'],
            explanation: 'Procédures différentes',
          },
        ]);

        const result = await service.search(query, {
          userId: 'tech-1',
          role: Role.TECHNICIAN,
        });

        expect(result.results.length).toBeGreaterThanOrEqual(2);
        expect(aiService.detectContradictions).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'tkt-1',
              title: 'Imprimante bloquée',
              content: 'Imprimante réseau bloquée, redémarrage du spouleur',
            }),
            expect.objectContaining({
              id: 'doc-1',
              title: 'Procédure imprimante réseau',
              content: 'Imprimante réseau bloquée, redémarrage du spouleur',
            }),
          ]),
        );
        expect(result.contradictions).toEqual([
          {
            sourceIds: ['tkt-1', 'doc-1'],
            explanation: 'Procédures différentes',
          },
        ]);
      });

      it('returns an empty contradictions array when AiService reports none (RM-05 default)', async () => {
        await seedTwoMatchingSources();

        const result = await service.search(query, {
          userId: 'tech-1',
          role: Role.TECHNICIAN,
        });

        expect(result.contradictions).toEqual([]);
      });
    });

    // docs/10-architecture-rag.md §12 "Supervision et qualité".
    describe('SearchLog', () => {
      async function seedOneMatchingSource() {
        const content = 'Imprimante réseau bloquée, redémarrage du spouleur';
        prisma.documentChunk.findMany.mockResolvedValue([
          {
            id: 'chunk-match',
            documentId: null,
            ticketId: 'tkt-1',
            knowledgeArticleId: null,
            scriptId: null,
            knowledgeLevel: 3,
            ownerId: null,
            content,
            embedding: await embed(content),
            embeddingProvider: 'HASHING',
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
      }

      it('records a SearchLog with the requester, the result count/positions, and a non-negative latency', async () => {
        await seedOneMatchingSource();

        await service.search('imprimante réseau bloquée redémarrage spouleur', {
          userId: 'tech-1',
          role: Role.TECHNICIAN,
        });

        expect(prisma.searchLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              requesterId: 'tech-1',
              query: 'imprimante réseau bloquée redémarrage spouleur',
              resultCount: 1,
              lowConfidence: false,
              latencyMs: expect.any(Number),
              results: {
                create: [
                  expect.objectContaining({
                    originId: 'tkt-1',
                    sourceType: 'TICKET',
                    position: 0,
                  }),
                ],
              },
            }),
          }),
        );
        const call = prisma.searchLog.create.mock.calls[0][0];
        expect(call.data.latencyMs).toBeGreaterThanOrEqual(0);
      });

      it('still returns search results when recording the SearchLog fails (best-effort)', async () => {
        await seedOneMatchingSource();
        prisma.searchLog.create.mockRejectedValue(new Error('DB down'));

        const result = await service.search(
          'imprimante réseau bloquée redémarrage spouleur',
          { userId: 'tech-1', role: Role.TECHNICIAN },
        );

        expect(result.results).toHaveLength(1);
      });
    });
  });

  // docs/10-architecture-rag.md §12 "Supervision et qualité".
  describe('getQualityMetrics', () => {
    it('computes every indicator from real aggregates, with no data faked when there is none yet', async () => {
      prisma.searchLog.count
        .mockResolvedValueOnce(10) // totalSearches
        .mockResolvedValueOnce(3); // lowConfidenceCount
      prisma.searchLog.aggregate.mockResolvedValue({
        _avg: { latencyMs: 42.5 },
      });
      prisma.searchLogResult.aggregate.mockResolvedValue({
        _avg: { rank: 0.61 },
      });
      prisma.aiMessage.aggregate.mockResolvedValue({
        _sum: { tokenCost: { toNumber: () => 1.23 } },
        _count: 7,
      });
      prisma.searchLogResult.groupBy.mockResolvedValue([
        {
          originId: 'doc-1',
          sourceType: 'DOCUMENT',
          title: 'Procédure X',
          _count: { originId: 5 },
        },
      ]);
      prisma.searchLogResult.findMany.mockResolvedValue([
        { originId: 'doc-1' },
      ]);
      const staleDoc = {
        id: 'doc-2',
        title: 'Vieille procédure jamais trouvée',
        knowledgeLevel: 2,
        createdAt: new Date('2020-01-01'),
      };
      prisma.knowledgeDocument.findMany.mockResolvedValue([staleDoc]);

      const result = await service.getQualityMetrics();

      expect(result.totalSearches).toBe(10);
      expect(result.relevantResponseRate).toBeCloseTo(0.7); // (10-3)/10
      expect(result.avgLatencyMs).toBe(42.5);
      expect(result.avgConfidence).toBe(0.61);
      expect(result.aiCost).toEqual({ totalTokenCost: 1.23, callCount: 7 });
      expect(result.topDocuments).toEqual([
        {
          originId: 'doc-1',
          sourceType: 'DOCUMENT',
          title: 'Procédure X',
          timesReturned: 5,
        },
      ]);
      expect(result.staleDocuments).toEqual([staleDoc]);
      // doc-1 est apparu au moins une fois : jamais listé comme obsolète,
      // quel que soit son âge.
      expect(prisma.knowledgeDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { notIn: ['doc-1'] },
          }),
        }),
      );
    });

    it('returns null rates rather than dividing by zero when there is no search history yet', async () => {
      const result = await service.getQualityMetrics();

      expect(result.totalSearches).toBe(0);
      expect(result.relevantResponseRate).toBeNull();
      expect(result.avgLatencyMs).toBeNull();
      expect(result.avgConfidence).toBeNull();
      expect(result.aiCost).toEqual({ totalTokenCost: 0, callCount: 0 });
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
      // rag/embedding.util.ts : aucune clé Voyage AI dans cet environnement
      // de test — chaque chunk indexé doit tracer le repli local (RM-05).
      expect(prisma.documentChunk.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ embeddingProvider: 'HASHING' }),
        }) as unknown,
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
            // rag/embedding.util.ts : aucune clé Voyage AI dans cet
            // environnement de test — le repli local (RM-05) doit être
            // explicitement tracé sur le chunk stocké (doc 10 §9).
            embeddingProvider: 'HASHING',
          }) as unknown,
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
