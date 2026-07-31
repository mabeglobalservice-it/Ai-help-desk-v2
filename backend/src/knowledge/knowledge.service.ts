import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface KnowledgeSearchResult {
  id: string;
  reference: string;
  title: string;
  summary: string | null;
  resolvedAt: Date | null;
  categoryName: string;
  priorityName: string;
  rank: number;
  snippet: string;
}

// docs/10-architecture-rag.md section 13, niveau 3 ("Tickets résolus") : la
// tranche la plus simple du RAG multi-niveaux — pas d'ingestion de
// documents, pas d'embeddings, juste la recherche plein texte PostgreSQL
// (tsvector/ts_rank) sur les tickets déjà résolus. Les niveaux 1/2/4/5
// (documentation constructeur, procédures internes, automatisations,
// notes personnelles) ne sont pas implémentés.
@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  // docs/05-user-stories.md US-26 : un technicien cherche parmi les tickets
  // déjà résolus pour s'inspirer d'une résolution déjà appliquée.
  async search(query: string): Promise<KnowledgeSearchResult[]> {
    return this.prisma.$queryRaw<KnowledgeSearchResult[]>(Prisma.sql`
      SELECT
        t.id,
        t.reference,
        t.title,
        t.summary,
        t.resolved_at AS "resolvedAt",
        c.name AS "categoryName",
        p.name AS "priorityName",
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
      ORDER BY rank DESC
      LIMIT 20
    `);
  }
}
