import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KnowledgeArticleStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { chunkText } from './rag/chunking.util';
import {
  cosineSimilarity,
  embedWithProvider,
  lexicalOverlap,
  tokenize,
} from './rag/embedding.util';
import { CreateKnowledgeDocumentDto } from './dto/create-knowledge-document.dto';

export interface KnowledgeSearchResult {
  id: string;
  sourceType: 'TICKET' | 'ARTICLE' | 'SCRIPT' | 'DOCUMENT';
  title: string;
  summary: string | null;
  reference: string | null;
  resolvedAt: Date | null;
  categoryName: string | null;
  priorityName: string | null;
  knowledgeLevel: number;
  rank: number;
  snippet: string;
}

// docs/10-architecture-rag.md §9 (Agent Documentation) : "signaler
// explicitement lorsque la confiance de la recherche est faible, plutôt
// que de forcer une réponse peu fiable" — distinct du filtrage
// RELEVANCE_THRESHOLD (qui écarte un chunk trop faible pour être utile du
// tout) : un résultat peut franchir ce seuil sans être une correspondance
// solide sur laquelle fonder une réponse présentée comme fiable.
export interface KnowledgeSearchResponse {
  results: KnowledgeSearchResult[];
  lowConfidence: boolean;
}

interface Requester {
  userId: string;
  role: Role;
}

// docs/10-architecture-rag.md §10 (sécurité documentaire) : le filtrage par
// droits d'accès doit s'appliquer à l'étape de recherche, pas en
// post-traitement — un chunk d'un niveau non autorisé n'est jamais fetché.
const ROLE_LEVELS: Record<Role, number[]> = {
  [Role.EMPLOYEE]: [1],
  [Role.TECHNICIAN]: [1, 2, 3, 4],
  [Role.SUPERVISOR]: [1, 2, 3, 4],
  [Role.ADMIN]: [1, 2, 3, 4, 5],
};

// En dessous de ce score combiné (similarité cosinus + recouvrement
// lexical, voir rag/embedding.util.ts), un chunk est écarté plutôt que
// forcé dans les résultats (doc 10 §8, "seuil de similarité minimal").
const RELEVANCE_THRESHOLD = 0.2;
// Au-dessus du seuil de pertinence minimal mais en dessous de celui-ci, un
// résultat est encore renvoyé (c'est la meilleure information disponible)
// mais signalé comme peu fiable plutôt que présenté comme une réponse
// documentée solide (doc 10 §9).
const CONFIDENCE_THRESHOLD = 0.4;
const MAX_CANDIDATES = 500;
const TOP_K = 10;
const COSINE_WEIGHT = 0.6;
const LEXICAL_WEIGHT = 0.4;

const ARTICLE_INCLUDE = {
  ticket: {
    select: { id: true, reference: true, title: true },
  },
  approvedBy: {
    select: { id: true, displayName: true, email: true },
  },
} as const;

function buildSnippet(content: string, queryTokens: string[]): string {
  const trimmed = content.trim();
  const lower = trimmed.toLowerCase();
  let matchIndex = -1;
  for (const token of queryTokens) {
    const idx = lower.indexOf(token);
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) matchIndex = idx;
  }

  const windowStart = Math.max(0, (matchIndex === -1 ? 0 : matchIndex) - 60);
  const windowEnd = Math.min(trimmed.length, windowStart + 220);
  let excerpt = trimmed.slice(windowStart, windowEnd);
  if (windowStart > 0) excerpt = `…${excerpt}`;
  if (windowEnd < trimmed.length) excerpt = `${excerpt}…`;

  for (const token of queryTokens) {
    if (token.length < 2) continue;
    const pattern = new RegExp(
      `(${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`,
      'gi',
    );
    excerpt = excerpt.replace(pattern, '**$1**');
  }

  return excerpt;
}

// docs/10-architecture-rag.md section 13 ("RAG multi-niveaux") : la
// connaissance est organisée en 5 niveaux (public, interne, tickets
// résolus, automatisation, personnel), chacun avec ses propres règles
// d'accès et de confiance. DocumentChunk est l'unité de recherche unifiée
// pour les 5 niveaux — voir prisma/schema.prisma pour le détail. Aucune
// extension pgvector disponible sur cette instance Postgres locale : la
// similarité vectorielle est calculée en application (voir search()),
// combinée à un recouvrement lexical (reranking, doc §8) pour la robustesse.
// Les embeddings eux-mêmes viennent de Voyage AI si VOYAGE_API_KEY est
// configurée, sinon d'un vectoriseur déterministe local en repli (RM-05) —
// voir rag/embedding.util.ts pour le détail et pourquoi les deux ne sont
// jamais comparés entre eux.
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  // docs/05-user-stories.md US-26, docs/10-architecture-rag.md §8 (pipeline
  // de recherche) : embedding de la requête → recherche parmi les chunks
  // accessibles au rôle du demandeur → reranking → top K.
  async search(
    query: string,
    requester: Requester,
  ): Promise<KnowledgeSearchResponse> {
    const queryTokens = tokenize(query);
    const { vector: queryVector, provider: queryProvider } =
      await embedWithProvider(query);

    const levels = ROLE_LEVELS[requester.role];
    const where: Prisma.DocumentChunkWhereInput =
      requester.role === Role.ADMIN
        ? {}
        : {
            OR: [
              { knowledgeLevel: { in: levels } },
              { knowledgeLevel: 5, ownerId: requester.userId },
            ],
          };

    const candidates = await this.prisma.documentChunk.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_CANDIDATES,
    });

    const scored = candidates
      .map((chunk) => {
        // rag/embedding.util.ts : un chunk hashing (256 dims) et un chunk
        // Voyage (1024 dims) ne sont jamais comparables — un chunk d'un
        // autre fournisseur que la requête courante n'a pas de signal
        // cosinus valide, seul le recouvrement lexical s'applique.
        const cosine =
          chunk.embeddingProvider === queryProvider
            ? cosineSimilarity(queryVector, chunk.embedding)
            : 0;
        const lexical = lexicalOverlap(queryTokens, tokenize(chunk.content));
        const score = COSINE_WEIGHT * cosine + LEXICAL_WEIGHT * lexical;
        return { chunk, score };
      })
      .filter(({ score }) => score >= RELEVANCE_THRESHOLD);

    // Un document televerse peut avoir plusieurs chunks : un seul resultat
    // par origine (le chunk le mieux note), comme pour un ticket/article/
    // script qui n'ont qu'un chunk aujourd'hui.
    const bestByOrigin = new Map<string, (typeof scored)[number]>();
    for (const entry of scored) {
      const originKey =
        entry.chunk.documentId ??
        entry.chunk.ticketId ??
        entry.chunk.knowledgeArticleId ??
        entry.chunk.scriptId ??
        entry.chunk.id;
      const existing = bestByOrigin.get(originKey);
      if (!existing || entry.score > existing.score) {
        bestByOrigin.set(originKey, entry);
      }
    }

    const top = [...bestByOrigin.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    const results = await this.hydrateResults(top, queryTokens);
    const lowConfidence =
      results.length === 0 || results[0].rank < CONFIDENCE_THRESHOLD;

    return { results, lowConfidence };
  }

  private async hydrateResults(
    scored: {
      chunk: Prisma.DocumentChunkGetPayload<Record<string, never>>;
      score: number;
    }[],
    queryTokens: string[],
  ): Promise<KnowledgeSearchResult[]> {
    const ticketIds = scored
      .map((s) => s.chunk.ticketId)
      .filter((id): id is string => !!id);
    const articleIds = scored
      .map((s) => s.chunk.knowledgeArticleId)
      .filter((id): id is string => !!id);
    const scriptIds = scored
      .map((s) => s.chunk.scriptId)
      .filter((id): id is string => !!id);
    const documentIds = scored
      .map((s) => s.chunk.documentId)
      .filter((id): id is string => !!id);

    const [tickets, articles, scripts, documents] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { id: { in: ticketIds } },
        include: { category: true, priority: true },
      }),
      this.prisma.knowledgeArticle.findMany({
        where: { id: { in: articleIds } },
        include: ARTICLE_INCLUDE,
      }),
      this.prisma.script.findMany({ where: { id: { in: scriptIds } } }),
      this.prisma.knowledgeDocument.findMany({
        where: { id: { in: documentIds } },
      }),
    ]);

    const ticketById = new Map(tickets.map((t) => [t.id, t]));
    const articleById = new Map(articles.map((a) => [a.id, a]));
    const scriptById = new Map(scripts.map((s) => [s.id, s]));
    const documentById = new Map(documents.map((d) => [d.id, d]));

    const results: KnowledgeSearchResult[] = [];
    for (const { chunk, score } of scored) {
      const snippet = buildSnippet(chunk.content, queryTokens);

      if (chunk.ticketId) {
        const ticket = ticketById.get(chunk.ticketId);
        if (!ticket) continue;
        results.push({
          id: ticket.id,
          sourceType: 'TICKET',
          title: ticket.title,
          summary: ticket.summary,
          reference: ticket.reference,
          resolvedAt: ticket.resolvedAt,
          categoryName: ticket.category.name,
          priorityName: ticket.priority.name,
          knowledgeLevel: chunk.knowledgeLevel,
          rank: score,
          snippet,
        });
        continue;
      }

      if (chunk.knowledgeArticleId) {
        const article = articleById.get(chunk.knowledgeArticleId);
        if (!article) continue;
        results.push({
          id: article.id,
          sourceType: 'ARTICLE',
          title: article.title,
          summary: article.content,
          reference: article.ticket?.reference ?? null,
          resolvedAt: null,
          categoryName: null,
          priorityName: null,
          knowledgeLevel: chunk.knowledgeLevel,
          rank: score,
          snippet,
        });
        continue;
      }

      if (chunk.scriptId) {
        const script = scriptById.get(chunk.scriptId);
        if (!script) continue;
        results.push({
          id: script.id,
          sourceType: 'SCRIPT',
          title: script.name,
          summary: script.content,
          reference: null,
          resolvedAt: null,
          categoryName: null,
          priorityName: null,
          knowledgeLevel: chunk.knowledgeLevel,
          rank: score,
          snippet,
        });
        continue;
      }

      if (chunk.documentId) {
        const document = documentById.get(chunk.documentId);
        if (!document) continue;
        results.push({
          id: document.id,
          sourceType: 'DOCUMENT',
          title: document.title,
          summary: document.content,
          reference: null,
          resolvedAt: null,
          categoryName: null,
          priorityName: null,
          knowledgeLevel: chunk.knowledgeLevel,
          rank: score,
          snippet,
        });
      }
    }

    return results;
  }

  // docs/11-documentation-api.md §7 (POST /knowledge/documents) : Technicien
  // limité au niveau 5 (personnel, ownerId forcé à lui-même), Admin limité
  // aux niveaux 1/2/4 (le 3 et le 5 sont alimentés automatiquement ailleurs).
  async createDocument(dto: CreateKnowledgeDocumentDto, requester: Requester) {
    let knowledgeLevel: number;
    let ownerId: string | null = null;

    if (requester.role === Role.TECHNICIAN) {
      knowledgeLevel = 5;
      ownerId = requester.userId;
    } else if (requester.role === Role.ADMIN) {
      knowledgeLevel = dto.knowledgeLevel ?? 2;
      if (![1, 2, 4].includes(knowledgeLevel)) {
        throw new BadRequestException(
          "Un Admin ne peut téléverser un document qu'aux niveaux 1, 2 ou 4",
        );
      }
    } else {
      throw new ForbiddenException(
        "Vous n'êtes pas autorisé à téléverser un document",
      );
    }

    const document = await this.prisma.knowledgeDocument.create({
      data: {
        title: dto.title,
        content: dto.content,
        knowledgeLevel,
        ownerId,
        uploadedById: requester.userId,
        authorName: dto.authorName,
        sourceVersion: dto.sourceVersion,
      },
    });

    await this.indexDocumentContent(
      document.id,
      dto.title,
      dto.content,
      knowledgeLevel,
      ownerId,
    );

    return document;
  }

  async getDocument(id: string, requester: Requester) {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
      include: { owner: { select: { id: true, displayName: true } } },
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} introuvable`);
    }
    if (
      !this.canAccessLevel(document.knowledgeLevel, document.ownerId, requester)
    ) {
      throw new ForbiddenException("Vous n'avez pas accès à ce document");
    }
    return document;
  }

  // docs/11-documentation-api.md §7 : propriétaire (niveau 5), Admin.
  async deleteDocument(id: string, requester: Requester) {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
    if (!document) {
      throw new NotFoundException(`Document ${id} introuvable`);
    }
    const isOwner =
      document.knowledgeLevel === 5 && document.ownerId === requester.userId;
    if (!isOwner && requester.role !== Role.ADMIN) {
      throw new ForbiddenException(
        "Vous n'avez pas le droit de retirer ce document",
      );
    }

    await this.prisma.documentChunk.deleteMany({ where: { documentId: id } });
    return this.prisma.knowledgeDocument.delete({ where: { id } });
  }

  private canAccessLevel(
    level: number,
    ownerId: string | null,
    requester: Requester,
  ): boolean {
    if (requester.role === Role.ADMIN) return true;
    if (level === 5) return ownerId === requester.userId;
    return ROLE_LEVELS[requester.role].includes(level);
  }

  private async indexDocumentContent(
    documentId: string,
    title: string,
    content: string,
    knowledgeLevel: number,
    ownerId: string | null,
  ) {
    const chunks = chunkText(`${title}\n\n${content}`);
    await Promise.all(
      chunks.map(async (chunkContent, position) => {
        const { vector, provider } = await embedWithProvider(chunkContent);
        return this.prisma.documentChunk.create({
          data: {
            documentId,
            knowledgeLevel,
            ownerId,
            sourceLabel: title,
            content: chunkContent,
            position,
            embedding: vector,
            embeddingProvider: provider,
          },
        });
      }),
    );
  }

  // docs/10-architecture-rag.md §13 niveau 3 ("tickets résolus") : indexé
  // immédiatement à la résolution, indépendamment de la proposition
  // d'article (qui suit son propre circuit de validation, voir §11 et
  // proposeArticleFromTicket ci-dessous).
  async indexResolvedTicket(ticket: {
    id: string;
    reference: string;
    title: string;
    summary: string | null;
    resolutionNote: string | null;
  }) {
    const content = [ticket.title, ticket.summary, ticket.resolutionNote]
      .filter(Boolean)
      .join('\n\n');
    const { vector, provider } = await embedWithProvider(content);

    await this.prisma.documentChunk.create({
      data: {
        ticketId: ticket.id,
        knowledgeLevel: 3,
        sourceLabel: ticket.reference,
        content,
        embedding: vector,
        embeddingProvider: provider,
      },
    });
  }

  // docs/10-architecture-rag.md §13 niveau 2 ("connaissances internes") :
  // une fois validé humainement (§11 "apprentissage continu"), un article
  // devient une procédure interne réutilisable, pas seulement un historique
  // d'incident brut (niveau 3, déjà couvert par indexResolvedTicket).
  private async indexApprovedArticle(article: {
    id: string;
    title: string;
    content: string;
  }) {
    const content = `${article.title}\n\n${article.content}`;
    const { vector, provider } = await embedWithProvider(content);
    await this.prisma.documentChunk.create({
      data: {
        knowledgeArticleId: article.id,
        knowledgeLevel: 2,
        sourceLabel: article.title,
        content,
        embedding: vector,
        embeddingProvider: provider,
      },
    });
  }

  // docs/10-architecture-rag.md §13 niveau 4 ("automatisation") : un script
  // catalogué par un Admin est, par définition, validé pour l'organisation
  // — isSensitive régit seulement l'approbation requise à l'exécution, pas
  // la consultation en lecture.
  async indexScript(script: { id: string; name: string; content: string }) {
    const content = `${script.name}\n\n${script.content}`;
    const { vector, provider } = await embedWithProvider(content);
    await this.prisma.documentChunk.create({
      data: {
        scriptId: script.id,
        knowledgeLevel: 4,
        sourceLabel: script.name,
        content,
        embedding: vector,
        embeddingProvider: provider,
      },
    });
  }

  // docs/11-documentation-api.md §7 (POST /knowledge/articles/propose,
  // accès "Système, automatique après résolution") : appelé en interne par
  // TicketsService lors du passage d'un ticket à RESOLVED — jamais exposé
  // en route HTTP publique, puisqu'aucun acteur humain n'est censé
  // déclencher cette action directement.
  async proposeArticleFromTicket(ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { category: true },
    });
    if (!ticket) return null;

    const draft = await this.aiService.summarizeTicketForKnowledgeArticle({
      title: ticket.title,
      summary: ticket.summary,
      resolutionNote: ticket.resolutionNote,
      categoryName: ticket.category.name,
    });

    return this.prisma.knowledgeArticle.create({
      data: {
        ticketId: ticket.id,
        title: draft.title,
        content: draft.content,
      },
    });
  }

  // docs/06-cas-utilisation.md UC-015 étape 8 : une résolution automatique
  // (sans ticket) génère aussi une proposition d'article — même circuit de
  // validation humaine que proposeArticleFromTicket (doc 10 §11, "jamais
  // sans validation humaine"), juste rattachée à autoResolutionId au lieu
  // de ticketId. Appelé en interne par AutomationService, jamais exposé
  // directement.
  async proposeArticleFromAutoResolution(
    autoResolutionId: string,
    description: string,
    outputLog: string,
  ) {
    const draft = await this.aiService.summarizeTicketForKnowledgeArticle({
      title: description.slice(0, 80),
      summary: description,
      resolutionNote: outputLog,
      categoryName: 'Automatisation',
    });

    return this.prisma.knowledgeArticle.create({
      data: {
        autoResolutionId,
        title: draft.title,
        content: draft.content,
      },
    });
  }

  // docs/11-documentation-api.md §7 : "Technicien senior, Superviseur" —
  // ce projet ne modélise pas de notion de séniorité technicien ; simplifié
  // à SUPERVISOR/ADMIN (même principe que les autres files de validation
  // partagées de l'application, ex. module Automation).
  findPendingArticles() {
    return this.prisma.knowledgeArticle.findMany({
      where: { status: KnowledgeArticleStatus.PROPOSED },
      include: ARTICLE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  async decideArticle(
    id: string,
    decision: KnowledgeArticleStatus,
    approverId: string,
  ) {
    if (
      decision !== KnowledgeArticleStatus.APPROVED &&
      decision !== KnowledgeArticleStatus.REJECTED
    ) {
      throw new BadRequestException(
        'La décision doit être APPROVED ou REJECTED',
      );
    }

    const article = await this.prisma.knowledgeArticle.findUnique({
      where: { id },
    });
    if (!article) {
      throw new NotFoundException(`Article ${id} introuvable`);
    }
    if (article.status !== KnowledgeArticleStatus.PROPOSED) {
      throw new BadRequestException('Cet article a déjà été traité');
    }

    const updated = await this.prisma.knowledgeArticle.update({
      where: { id },
      data: {
        status: decision,
        approvedById: approverId,
        decidedAt: new Date(),
      },
      include: ARTICLE_INCLUDE,
    });

    if (decision === KnowledgeArticleStatus.APPROVED) {
      await this.indexApprovedArticle(updated);
    }

    return updated;
  }
}
