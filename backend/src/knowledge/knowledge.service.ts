import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KnowledgeArticleStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';

export interface KnowledgeSearchResult {
  id: string;
  reference: string;
  title: string;
  summary: string | null;
  resolvedAt: Date | null;
  categoryName: string;
  priorityName: string;
  sourceType: 'TICKET' | 'ARTICLE';
  rank: number;
  snippet: string;
}

const ARTICLE_INCLUDE = {
  ticket: {
    select: { id: true, reference: true, title: true },
  },
  approvedBy: {
    select: { id: true, displayName: true, email: true },
  },
} as const;

// docs/10-architecture-rag.md section 13, niveau 3 ("Tickets résolus") : la
// tranche la plus simple du RAG multi-niveaux — pas d'ingestion de
// documents, pas d'embeddings, juste la recherche plein texte PostgreSQL
// (tsvector/ts_rank) sur les tickets déjà résolus et les articles de
// connaissance approuvés. Les niveaux 1/2/4/5 (documentation constructeur,
// procédures internes, automatisations, notes personnelles) ne sont pas
// implémentés.
@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  // docs/05-user-stories.md US-26 : un technicien cherche parmi les tickets
  // déjà résolus et les articles de connaissance approuvés (§11 doc 10) pour
  // s'inspirer d'une résolution déjà appliquée.
  async search(query: string): Promise<KnowledgeSearchResult[]> {
    return this.prisma.$queryRaw<KnowledgeSearchResult[]>(Prisma.sql`
      SELECT * FROM (
        SELECT
          t.id,
          t.reference,
          t.title,
          t.summary,
          t.resolved_at AS "resolvedAt",
          c.name AS "categoryName",
          p.name AS "priorityName",
          'TICKET' AS "sourceType",
          ts_rank(
            to_tsvector('french', t.title || ' ' || coalesce(t.summary, '')),
            plainto_tsquery('french', ${query})
          ) AS rank,
          ts_headline(
            'french',
            t.title || ' — ' || coalesce(t.summary, ''),
            plainto_tsquery('french', ${query}),
            'StartSel=**,StopSel=**,MaxWords=40,MinWords=15'
          ) AS snippet
        FROM tickets t
        JOIN ticket_categories c ON c.id = t.category_id
        JOIN priorities p ON p.id = t.priority_id
        WHERE t.status = 'RESOLVED'
          AND to_tsvector('french', t.title || ' ' || coalesce(t.summary, ''))
            @@ plainto_tsquery('french', ${query})

        UNION ALL

        SELECT
          ka.id,
          t.reference,
          ka.title,
          ka.content AS summary,
          t.resolved_at AS "resolvedAt",
          c.name AS "categoryName",
          p.name AS "priorityName",
          'ARTICLE' AS "sourceType",
          ts_rank(
            to_tsvector('french', ka.title || ' ' || ka.content),
            plainto_tsquery('french', ${query})
          ) AS rank,
          ts_headline(
            'french',
            ka.title || ' — ' || ka.content,
            plainto_tsquery('french', ${query}),
            'StartSel=**,StopSel=**,MaxWords=40,MinWords=15'
          ) AS snippet
        FROM knowledge_articles ka
        JOIN tickets t ON t.id = ka.ticket_id
        JOIN ticket_categories c ON c.id = t.category_id
        JOIN priorities p ON p.id = t.priority_id
        WHERE ka.status = 'APPROVED'
          AND to_tsvector('french', ka.title || ' ' || ka.content)
            @@ plainto_tsquery('french', ${query})
      ) combined
      ORDER BY rank DESC
      LIMIT 20
    `);
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

    return this.prisma.knowledgeArticle.update({
      where: { id },
      data: {
        status: decision,
        approvedById: approverId,
        decidedAt: new Date(),
      },
      include: ARTICLE_INCLUDE,
    });
  }
}
