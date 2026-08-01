import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

const MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT =
  "Tu es un assistant de triage pour un service d'assistance informatique interne. " +
  "À partir de la description d'un problème par un employé, tu dois suggérer un titre concis, " +
  'la catégorie la plus pertinente et la priorité la plus adaptée, en choisissant strictement ' +
  'parmi les catégories et priorités fournies. Une priorité élevée est réservée aux problèmes ' +
  'bloquants ou touchant plusieurs personnes ; une priorité faible convient aux demandes non urgentes.';

interface DiagnoseSuggestion {
  title: string;
  categoryId: string;
  priorityId: string;
}

interface ArticleSuggestion {
  title: string;
  content: string;
}

export interface KnowledgeArticleDraft {
  title: string;
  content: string;
  // docs/06-cas-utilisation.md RM-05: true when this draft came from the
  // local template fallback rather than the AI provider.
  degraded: boolean;
}

export interface ResolvedTicketSummaryInput {
  title: string;
  summary: string | null;
  resolutionNote: string | null;
  categoryName: string;
}

const ARTICLE_SYSTEM_PROMPT =
  "Tu es l'Agent Documentation d'un service d'assistance informatique interne. " +
  "À partir du contexte d'un ticket résolu (problème décrit, catégorie, note de résolution), " +
  'rédige un article de base de connaissances concis et réutilisable pour un futur incident ' +
  'similaire : un titre clair et un contenu structuré en deux parties, "Cause probable" et ' +
  '"Solution appliquée". Reste factuel, ne generalise pas au-delà de ce que le ticket décrit.';

export interface TicketDiagnosis {
  title: string;
  categoryId: string;
  categoryName: string;
  priorityId: string;
  priorityName: string;
  // RM-05: true when this suggestion came from the local keyword fallback
  // rather than the AI provider (which was unavailable or failed)
  degraded: boolean;
}

interface CategoryOption {
  id: string;
  name: string;
}

interface PriorityOption {
  id: string;
  name: string;
  level: number;
}

// docs/06-cas-utilisation.md RM-05: keyword synonyms for the local fallback
// diagnosis used when the AI provider is unavailable, keyed by normalized
// (lowercased, accent-stripped) category name — degrades sensibly even if
// the seeded catalog differs from this project's default four categories.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  reseau: [
    'reseau',
    'wifi',
    'wi-fi',
    'internet',
    'vpn',
    'ethernet',
    'debit',
    'latence',
    'ping',
    'connexion internet',
  ],
  materiel: [
    'ordinateur',
    ' pc ',
    'ecran',
    'clavier',
    'souris',
    'imprimante',
    'portable',
    'laptop',
    'batterie',
    'chargeur',
    'casque',
    'webcam',
    'disque dur',
    'materiel',
    "ne s'allume plus",
    'ne demarre plus',
  ],
  logiciel: [
    'logiciel',
    'application',
    'programme',
    'erreur',
    'bug',
    'plantage',
    'crash',
    'mise a jour',
    'installation',
    'licence',
    'office',
    'excel',
    'word',
    'outlook',
    'windows',
    'freeze',
    'ecran bleu',
  ],
  acces: [
    'mot de passe',
    'password',
    'compte',
    'acces',
    'verrouille',
    'bloque',
    'authentification',
    'identifiant',
    'login',
    'droits',
    'permission',
    'mfa',
    '2fa',
  ],
};

const URGENT_KEYWORDS = [
  'urgent',
  'urgence',
  'bloque',
  'bloquee',
  'critique',
  'panne totale',
  'plus personne',
  'production',
  'immediat',
  'grave',
  'tout le monde',
];

const LOW_KEYWORDS = [
  'quand vous pouvez',
  'pas presse',
  'pas urgent',
  'mineur',
  'suggestion',
  'amelioration',
];

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function countMatches(haystack: string, keywords: string[]): number {
  return keywords.reduce(
    (count, keyword) => (haystack.includes(keyword) ? count + 1 : count),
    0,
  );
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  // docs/06-cas-utilisation.md RM-05: le systeme doit rester fonctionnel en
  // mode degrade si l'agent IA est indisponible. Si la cle API est absente,
  // ou si l'appel echoue pour n'importe quelle raison, on retombe sur un
  // diagnostic local par mots-cles plutot que de faire echouer la creation
  // de ticket.
  async diagnoseTicket(description: string): Promise<TicketDiagnosis> {
    const [categories, priorities] = await Promise.all([
      this.prisma.ticketCategory.findMany({ select: { id: true, name: true } }),
      this.prisma.priority.findMany({
        select: { id: true, name: true, level: true },
        orderBy: { level: 'asc' },
      }),
    ]);

    if (categories.length === 0 || priorities.length === 0) {
      throw new ServiceUnavailableException(
        "Aucune catégorie ou priorité n'est configurée pour le moment.",
      );
    }

    if (!this.client) {
      this.logger.warn(
        'Clé API Anthropic absente : diagnostic en mode dégradé (mots-clés locaux)',
      );
      return this.localDiagnose(description, categories, priorities);
    }

    try {
      return await this.aiDiagnose(
        this.client,
        description,
        categories,
        priorities,
      );
    } catch (error) {
      this.logger.error(
        "Échec de l'analyse IA, repli en mode dégradé (mots-clés locaux)",
        error,
      );
      return this.localDiagnose(description, categories, priorities);
    }
  }

  private async aiDiagnose(
    client: Anthropic,
    description: string,
    categories: CategoryOption[],
    priorities: PriorityOption[],
  ): Promise<TicketDiagnosis> {
    const categoryList = categories
      .map((category) => `- ${category.id}: ${category.name}`)
      .join('\n');
    const priorityList = priorities
      .map(
        (priority) =>
          `- ${priority.id}: ${priority.name} (niveau ${priority.level})`,
      )
      .join('\n');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Description du problème :\n"""\n${description}\n"""\n\n` +
            `Catégories disponibles :\n${categoryList}\n\n` +
            `Priorités disponibles :\n${priorityList}`,
        },
      ],
      tools: [
        {
          name: 'suggest_ticket_details',
          description:
            'Suggère un titre, une catégorie et une priorité pour ce ticket',
          input_schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description:
                  'Titre concis et clair du ticket (moins de 80 caractères)',
              },
              categoryId: {
                type: 'string',
                enum: categories.map((category) => category.id),
                description: "L'identifiant de la catégorie choisie",
              },
              priorityId: {
                type: 'string',
                enum: priorities.map((priority) => priority.id),
                description: "L'identifiant de la priorité choisie",
              },
            },
            required: ['title', 'categoryId', 'priorityId'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'suggest_ticket_details' },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw new Error(
        "Réponse de l'IA inattendue : aucune suggestion structurée reçue",
      );
    }

    const suggestion = toolUse.input as DiagnoseSuggestion;

    const category =
      categories.find((c) => c.id === suggestion.categoryId) ?? categories[0];
    const priority =
      priorities.find((p) => p.id === suggestion.priorityId) ?? priorities[0];

    return {
      title: suggestion.title?.trim() || description.slice(0, 80),
      categoryId: category.id,
      categoryName: category.name,
      priorityId: priority.id,
      priorityName: priority.name,
      degraded: false,
    };
  }

  private localDiagnose(
    description: string,
    categories: CategoryOption[],
    priorities: PriorityOption[],
  ): TicketDiagnosis {
    const normalizedDescription = normalize(description);

    const category = this.pickCategory(normalizedDescription, categories);
    const priority = this.pickPriority(normalizedDescription, priorities);

    return {
      title: this.deriveTitle(description),
      categoryId: category.id,
      categoryName: category.name,
      priorityId: priority.id,
      priorityName: priority.name,
      degraded: true,
    };
  }

  private pickCategory(
    normalizedDescription: string,
    categories: CategoryOption[],
  ): CategoryOption {
    let best = categories[0];
    let bestScore = -1;

    for (const category of categories) {
      const normalizedName = normalize(category.name);
      const synonyms = CATEGORY_KEYWORDS[normalizedName] ?? [];
      const score =
        countMatches(normalizedDescription, synonyms) +
        (normalizedDescription.includes(normalizedName) ? 1 : 0);
      if (score > bestScore) {
        best = category;
        bestScore = score;
      }
    }

    return best;
  }

  private pickPriority(
    normalizedDescription: string,
    priorities: PriorityOption[],
  ): PriorityOption {
    const sorted = [...priorities].sort((a, b) => a.level - b.level);

    // LOW_KEYWORDS is checked first: its phrases are negations like "pas
    // urgent" that would otherwise also match the bare "urgent" substring
    // in URGENT_KEYWORDS and incorrectly win.
    if (countMatches(normalizedDescription, LOW_KEYWORDS) > 0) {
      return sorted[0];
    }
    if (countMatches(normalizedDescription, URGENT_KEYWORDS) > 0) {
      return sorted[sorted.length - 1];
    }
    return sorted[Math.floor(sorted.length / 2)];
  }

  private deriveTitle(description: string): string {
    const trimmed = description.trim();
    if (!trimmed) return 'Nouvelle demande';

    const firstSentence = trimmed.split(/(?<=[.!?])\s/)[0];
    const base = firstSentence.length > 5 ? firstSentence : trimmed;
    return base.length > 80 ? `${base.slice(0, 77)}...` : base;
  }

  // docs/10-architecture-rag.md §11 "Apprentissage continu" : un ticket
  // résolu génère une proposition d'article, jamais indexée automatiquement
  // (docs §11: validation humaine explicite requise avant indexation).
  async summarizeTicketForKnowledgeArticle(
    input: ResolvedTicketSummaryInput,
  ): Promise<KnowledgeArticleDraft> {
    if (!this.client) {
      this.logger.warn(
        "Clé API Anthropic absente : proposition d'article en mode dégradé (gabarit local)",
      );
      return this.localArticleDraft(input);
    }

    try {
      return await this.aiArticleDraft(this.client, input);
    } catch (error) {
      this.logger.error(
        "Échec de la génération IA de l'article, repli en mode dégradé (gabarit local)",
        error,
      );
      return this.localArticleDraft(input);
    }
  }

  private async aiArticleDraft(
    client: Anthropic,
    input: ResolvedTicketSummaryInput,
  ): Promise<KnowledgeArticleDraft> {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 768,
      system: ARTICLE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Titre du ticket : ${input.title}\n` +
            `Catégorie : ${input.categoryName}\n` +
            `Description du problème : ${input.summary ?? '(non fournie)'}\n` +
            `Note de résolution : ${input.resolutionNote ?? '(non fournie)'}`,
        },
      ],
      tools: [
        {
          name: 'propose_knowledge_article',
          description:
            'Propose un article de base de connaissances à partir de ce ticket résolu',
          input_schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description:
                  "Titre concis de l'article (moins de 100 caractères)",
              },
              content: {
                type: 'string',
                description:
                  'Contenu structuré en "Cause probable" et "Solution appliquée"',
              },
            },
            required: ['title', 'content'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'propose_knowledge_article' },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw new Error(
        "Réponse de l'IA inattendue : aucun article structuré reçu",
      );
    }

    const suggestion = toolUse.input as ArticleSuggestion;

    return {
      title: suggestion.title?.trim() || input.title,
      content:
        suggestion.content?.trim() || this.localArticleDraft(input).content,
      degraded: false,
    };
  }

  private localArticleDraft(
    input: ResolvedTicketSummaryInput,
  ): KnowledgeArticleDraft {
    const lines = [
      `Catégorie : ${input.categoryName}`,
      '',
      'Cause probable :',
      input.summary?.trim() || '(non renseignée)',
      '',
      'Solution appliquée :',
      input.resolutionNote?.trim() || '(non renseignée)',
    ];

    return {
      title: input.title,
      content: lines.join('\n'),
      degraded: true,
    };
  }
}
