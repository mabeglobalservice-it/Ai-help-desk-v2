import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiAgentName,
  AiConversationStatus,
  AiMessageRole,
  AiProviderName,
} from '../../generated/prisma/client';

const MODEL = 'claude-sonnet-5';

// docs/11-documentation-api.md §6 "GET /ai/conversations/:id/cost" : tarifs
// Anthropic par tranche de 1000 jetons, utilisés uniquement pour estimer le
// coût affiché au superviseur/admin — n'affecte jamais la facturation réelle.
const INPUT_TOKEN_COST_PER_1K = 0.003;
const OUTPUT_TOKEN_COST_PER_1K = 0.015;

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

// docs/05-user-stories.md US-28: "le système prépare une action ... afin de
// gagner du temps sur la saisie manuelle" — jamais une exécution directe
// (l'Agent Diagnostic "ne peut jamais initier une automatisation
// directement", docs/09-architecture-agents-ia.md §3.1) : seulement une
// pré-sélection de script + justification que le technicien reste libre de
// modifier ou d'ignorer avant de la proposer (docs/06 RM-01, module
// Automation déjà construit).
const AUTOMATION_SUGGESTION_SYSTEM_PROMPT =
  "Tu assistes un technicien de support informatique interne. À partir du contexte d'un " +
  "ticket et de la liste des scripts d'automatisation disponibles, indique lequel (s'il y en " +
  'a un) correspond réellement au problème décrit, et rédige une justification courte et ' +
  'factuelle basée sur le ticket. Ne force jamais une correspondance approximative : si aucun ' +
  'script ne correspond clairement, réponds avec scriptId "aucun".';

interface AutomationSuggestionResponse {
  scriptId: string;
  justification: string;
}

export interface ScriptOption {
  id: string;
  name: string;
  content: string;
}

export interface TicketContextForAutomation {
  title: string;
  summary: string | null;
  categoryName: string;
}

export interface AutomationSuggestion {
  scriptId: string;
  justification: string;
  degraded: boolean;
}

const NO_SUGGESTION = 'aucun';

// docs/06-cas-utilisation.md UC-015, RM-03 : une résolution automatique
// n'est jamais proposée sous 95% de confiance, ni pour une action touchant
// un compte/une permission/une identité — seulement des scripts déjà
// catalogués comme non sensibles (scripts.is_sensitive = false, jamais
// décidé par le LLM lui-même).
const AUTO_RESOLUTION_SYSTEM_PROMPT =
  "Tu es l'Agent IA d'un service d'assistance informatique interne, chargé d'identifier si un " +
  'problème peut être résolu automatiquement sans intervention humaine (UC-015). Tu ne dois ' +
  "proposer une résolution automatique QUE si le problème correspond clairement à l'un des " +
  "scripts non sensibles fournis, avec un niveau de confiance d'au moins 0.95. En cas de doute, " +
  "d'ambiguïté, ou si le problème pourrait toucher un compte, une permission ou une identité, " +
  'réponds eligible=false — le diagnostic conversationnel standard prendra le relais.';

interface AutoResolutionEvaluation {
  eligible: boolean;
  scriptId?: string;
  confidence?: number;
  explanation?: string;
}

export interface AutoResolutionSuggestion {
  scriptId: string;
  confidence: number;
  explanation: string;
}

interface DiagnosisResult {
  title: string;
  categoryId: string;
  categoryName: string;
  priorityId: string;
  priorityName: string;
  // RM-05: true when this suggestion came from the local keyword fallback
  // rather than the AI provider (which was unavailable or failed)
  degraded: boolean;
}

export interface TicketDiagnosis extends DiagnosisResult {
  // docs/08-architecture-ia.md §4.4, docs/11 §5/§6 : identifie la
  // conversation persistée pour cette analyse, afin de retrouver son
  // historique (/diagnostics/:conversationId) et son coût
  // (/ai/conversations/:id/cost).
  conversationId: string;
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

// docs/06-cas-utilisation.md UC-001, docs/09-architecture-agents-ia.md §3.2
// (Agent Help Desk) : diagnostic conversationnel multi-tour — cause
// probable + étapes de self-service (US-02), avant toute création de
// ticket (US-03).
export interface ConversationalDiagnosis extends DiagnosisResult {
  causeProbable: string;
  suggestedSteps: string[];
  confidence: number;
}

export type DiagnosticTurnResult =
  | { status: 'NEEDS_INFO'; conversationId: string; question: string }
  | {
      status: 'DIAGNOSED';
      conversationId: string;
      diagnosis: ConversationalDiagnosis;
    };

interface ConversationTurnEvaluation {
  needsMoreInfo: boolean;
  question?: string;
  title?: string;
  categoryId?: string;
  priorityId?: string;
  causeProbable?: string;
  suggestedSteps?: string[];
  confidence?: number;
}

// docs/09-architecture-agents-ia.md §3.2 : contrairement à l'Agent
// Diagnostic (mots-clés en repli, RM-05), l'Agent Help Desk ne pose jamais
// de question en mode dégradé — sans IA, un diagnostic immédiat (mêmes
// mots-clés locaux que diagnoseTicket) est produit directement, avec des
// étapes génériques et une confiance délibérément basse.
const HELPDESK_SYSTEM_PROMPT =
  "Tu es l'Agent Help Desk d'un service d'assistance informatique interne. Tu dialogues directement " +
  'avec un employé qui décrit un problème informatique en langage naturel, sans vocabulaire technique. ' +
  "Ton objectif : poser au plus UNE question de clarification à la fois si l'information manque pour " +
  'identifier une cause probable, puis proposer une cause probable et des étapes concrètes que ' +
  "l'employé peut essayer lui-même avant qu'un technicien n'intervienne. Choisis strictement la " +
  "catégorie et la priorité parmi celles fournies. Ne pose jamais plus d'une question par tour. Ne " +
  "fabrique jamais de détails sur l'environnement technique de l'organisation que tu ne connais pas.";

// docs/11-documentation-api.md §12 (GET/PATCH /admin/settings) : valeur par
// défaut si la table system_settings n'a pas encore été seedée — le nombre
// réellement utilisé est lu en base à chaque appel (getMaxClarifyingTurns).
const DEFAULT_MAX_CLARIFYING_TURNS = 3;

const DEGRADED_SUGGESTED_STEPS = [
  "Redémarrez l'appareil ou l'application concernée.",
  'Vérifiez les branchements et la connexion réseau.',
  'Si le problème persiste après ces étapes, un ticket sera créé pour ' +
    "qu'un technicien prenne le relais.",
];

// docs/09-architecture-agents-ia.md §3.3 (Agent Technicien) : assiste
// uniquement les techniciens — explique une panne, une commande ou un
// script à partir du contexte du ticket, de l'historique CMDB de l'actif
// concerné et d'extraits de la base documentaire. Contrairement à l'Agent
// Automation, il ne possède aucune capacité d'exécution : un script
// suggéré n'est qu'indicatif, toute exécution réelle doit transiter par le
// module Automation (avec approbation si l'action est sensible, RM-01).
export interface TechnicianAssistContext {
  ticketTitle: string;
  ticketSummary: string | null;
  categoryName: string;
  ciHistory: string | null;
  knowledgeExcerpts: string[];
}

export interface TechnicianAssistResult {
  explanation: string;
  suggestedScript: string | null;
  degraded: boolean;
  conversationId: string;
}

interface TechnicianAssistEvaluation {
  explanation: string;
  suggestedScript?: string | null;
}

const TECHNICIAN_ASSIST_SYSTEM_PROMPT =
  "Tu es l'Agent Technicien d'un service d'assistance informatique interne. Tu assistes exclusivement des " +
  'techniciens de support, jamais des employés directement. Ton rôle : expliquer une panne, une commande, ' +
  "un script ou une meilleure pratique, en t'appuyant sur le contexte du ticket fourni, l'historique CMDB " +
  "de l'actif concerné et les extraits de documentation fournis. Tu peux suggérer un script ou une commande " +
  "à titre indicatif, mais tu ne l'exécutes jamais toi-même : le technicien reste seul décisionnaire de le " +
  "faire passer par le module d'automatisation, avec approbation si l'action est sensible. Ne fabrique " +
  "jamais de détails sur l'environnement technique de l'organisation que tu ne connais pas.";

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

  // docs/11-documentation-api.md §6 : un agent désactivé par un Admin, ou
  // un fournisseur actif autre que CLAUDE (le seul réellement intégré),
  // dégrade exactement comme une clé API absente (RM-05) — même chemin de
  // repli. Ne revérifie pas la présence de la clé API (this.client) :
  // appelée uniquement après ce contrôle synchrone chez l'appelant, pour
  // que TypeScript garde le rétrécissement de this.client à travers l'await.
  // Renvoie aussi l'id de l'agent (quand il existe) pour éviter une requête
  // Prisma supplémentaire lors de la persistance d'AiMessage.agentId.
  private async checkAgentStatus(
    agentName: AiAgentName,
  ): Promise<{ enabled: boolean; agentId: string | null }> {
    const [agent, activeProvider] = await Promise.all([
      this.prisma.aiAgent.findUnique({ where: { name: agentName } }),
      this.prisma.aiProviderConfig.findUnique({
        where: { provider: AiProviderName.CLAUDE },
      }),
    ]);

    return {
      enabled: (agent?.isActive ?? true) && (activeProvider?.isActive ?? true),
      agentId: agent?.id ?? null,
    };
  }

  private computeTokenCost(usage: Anthropic.Usage): number {
    return (
      (usage.input_tokens / 1000) * INPUT_TOKEN_COST_PER_1K +
      (usage.output_tokens / 1000) * OUTPUT_TOKEN_COST_PER_1K
    );
  }

  // docs/08-architecture-ia.md §4.4 : chaque analyse (mode IA ou dégradé)
  // laisse une trace dans l'historique des conversations, consultable via
  // GET /diagnostics/:conversationId (docs/11 §5) — y compris en mode
  // dégradé, pour la visibilité du superviseur (responseTimeMs/tokenCost
  // restent alors null, faute d'appel réel au fournisseur IA).
  private async recordAgentMessage(
    conversationId: string,
    agentId: string | null,
    diagnosis: DiagnosisResult,
    responseTimeMs: number | null,
    tokenCost: number | null,
  ): Promise<void> {
    await this.prisma.aiMessage.create({
      data: {
        conversationId,
        agentId: agentId ?? undefined,
        role: AiMessageRole.AGENT,
        content:
          `Titre suggéré : ${diagnosis.title}\n` +
          `Catégorie : ${diagnosis.categoryName}\n` +
          `Priorité : ${diagnosis.priorityName}` +
          (diagnosis.degraded ? ' (mode dégradé)' : ''),
        responseTimeMs: responseTimeMs ?? undefined,
        tokenCost: tokenCost ?? undefined,
      },
    });
  }

  // docs/06-cas-utilisation.md RM-05: le systeme doit rester fonctionnel en
  // mode degrade si l'agent IA est indisponible. Si la cle API est absente,
  // si l'agent/fournisseur est désactivé (docs/11 §6), ou si l'appel
  // echoue pour n'importe quelle raison, on retombe sur un diagnostic
  // local par mots-cles plutot que de faire echouer la creation de ticket.
  async diagnoseTicket(
    description: string,
    userId: string,
  ): Promise<TicketDiagnosis> {
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

    const conversation = await this.prisma.aiConversation.create({
      data: { userId, provider: AiProviderName.CLAUDE, model: MODEL },
    });
    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        content: description,
      },
    });

    const { enabled, agentId } = await this.checkAgentStatus(
      AiAgentName.DIAGNOSTIC,
    );

    if (!this.client || !enabled) {
      this.logger.warn(
        'Agent Diagnostic indisponible (clé API absente, agent ou fournisseur désactivé) : mode dégradé (mots-clés locaux)',
      );
      const diagnosis = this.localDiagnose(description, categories, priorities);
      await this.recordAgentMessage(
        conversation.id,
        agentId,
        diagnosis,
        null,
        null,
      );
      return { ...diagnosis, conversationId: conversation.id };
    }

    try {
      const startedAt = Date.now();
      const { diagnosis, usage } = await this.aiDiagnose(
        this.client,
        description,
        categories,
        priorities,
      );
      await this.recordAgentMessage(
        conversation.id,
        agentId,
        diagnosis,
        Date.now() - startedAt,
        this.computeTokenCost(usage),
      );
      return { ...diagnosis, conversationId: conversation.id };
    } catch (error) {
      this.logger.error(
        "Échec de l'analyse IA, repli en mode dégradé (mots-clés locaux)",
        error,
      );
      const diagnosis = this.localDiagnose(description, categories, priorities);
      await this.recordAgentMessage(
        conversation.id,
        agentId,
        diagnosis,
        null,
        null,
      );
      return { ...diagnosis, conversationId: conversation.id };
    }
  }

  private async aiDiagnose(
    client: Anthropic,
    description: string,
    categories: CategoryOption[],
    priorities: PriorityOption[],
  ): Promise<{ diagnosis: DiagnosisResult; usage: Anthropic.Usage }> {
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
      diagnosis: {
        title: suggestion.title?.trim() || description.slice(0, 80),
        categoryId: category.id,
        categoryName: category.name,
        priorityId: priority.id,
        priorityName: priority.name,
        degraded: false,
      },
      usage: response.usage,
    };
  }

  private localDiagnose(
    description: string,
    categories: CategoryOption[],
    priorities: PriorityOption[],
  ): DiagnosisResult {
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

  // docs/06-cas-utilisation.md UC-001 étapes 1-6, docs/09-architecture-
  // agents-ia.md §3.2 (Agent Help Desk) : dialogue multi-tour — pose une
  // question de clarification à la fois (jusqu'à MAX_CLARIFYING_TURNS),
  // puis fournit un diagnostic (cause probable + étapes de self-service)
  // que l'employé confirme ou infirme via resolveConversation
  // (DiagnosticsService). conversationId=null démarre une nouvelle
  // conversation ; sinon, message est la réponse de l'employé à la
  // dernière question posée.
  async converseDiagnostic(
    conversationId: string | null,
    userId: string,
    message: string,
  ): Promise<DiagnosticTurnResult> {
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

    const conversation = await this.getOrStartConversation(
      conversationId,
      userId,
    );

    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        content: message,
      },
    });

    const history = [
      ...conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      { role: AiMessageRole.USER, content: message },
    ];
    const userTurns = history.filter(
      (m) => m.role === AiMessageRole.USER,
    ).length;
    const maxClarifyingTurns = await this.getMaxClarifyingTurns();
    const forceDiagnosis = userTurns >= maxClarifyingTurns;

    const { enabled, agentId } = await this.checkAgentStatus(
      AiAgentName.HELPDESK,
    );

    if (!this.client || !enabled) {
      this.logger.warn(
        'Agent Help Desk indisponible (clé API absente, agent ou fournisseur désactivé) : diagnostic immédiat en mode dégradé (mots-clés locaux)',
      );
      return this.degradeToImmediateDiagnosis(
        conversation.id,
        agentId,
        history,
        categories,
        priorities,
      );
    }

    try {
      const startedAt = Date.now();
      const { evaluation, usage } = await this.aiConverseDiagnostic(
        this.client,
        history,
        categories,
        priorities,
        forceDiagnosis,
      );
      const responseTimeMs = Date.now() - startedAt;
      const tokenCost = this.computeTokenCost(usage);

      if (evaluation.needsMoreInfo && !forceDiagnosis) {
        const question =
          evaluation.question?.trim() ||
          'Pouvez-vous préciser votre problème ?';
        await this.prisma.aiMessage.create({
          data: {
            conversationId: conversation.id,
            agentId: agentId ?? undefined,
            role: AiMessageRole.AGENT,
            content: question,
            responseTimeMs,
            tokenCost,
          },
        });
        return {
          status: 'NEEDS_INFO',
          conversationId: conversation.id,
          question,
        };
      }

      const diagnosis = this.buildDiagnosisFromEvaluation(
        evaluation,
        categories,
        priorities,
        message,
        false,
      );
      await this.recordConversationDiagnosis(
        conversation.id,
        agentId,
        diagnosis,
        responseTimeMs,
        tokenCost,
      );
      return {
        status: 'DIAGNOSED',
        conversationId: conversation.id,
        diagnosis,
      };
    } catch (error) {
      this.logger.error(
        'Échec du dialogue IA, repli sur un diagnostic immédiat en mode dégradé (mots-clés locaux)',
        error,
      );
      return this.degradeToImmediateDiagnosis(
        conversation.id,
        agentId,
        history,
        categories,
        priorities,
      );
    }
  }

  // docs/11-documentation-api.md §12 (GET/PATCH /admin/settings) : repli sur
  // DEFAULT_MAX_CLARIFYING_TURNS tant que system_settings n'a pas été seedé.
  private async getMaxClarifyingTurns(): Promise<number> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 'singleton' },
    });
    return settings?.maxClarifyingTurns ?? DEFAULT_MAX_CLARIFYING_TURNS;
  }

  private async getOrStartConversation(
    conversationId: string | null,
    userId: string,
  ) {
    if (!conversationId) {
      return this.prisma.aiConversation.create({
        data: { userId, provider: AiProviderName.CLAUDE, model: MODEL },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
    }

    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException(`Conversation ${conversationId} introuvable`);
    }
    if (conversation.status !== AiConversationStatus.ONGOING) {
      throw new BadRequestException('Cette conversation est déjà terminée');
    }
    return conversation;
  }

  private async degradeToImmediateDiagnosis(
    conversationId: string,
    agentId: string | null,
    history: { role: AiMessageRole; content: string }[],
    categories: CategoryOption[],
    priorities: PriorityOption[],
  ): Promise<DiagnosticTurnResult> {
    const combinedDescription = history
      .filter((m) => m.role === AiMessageRole.USER)
      .map((m) => m.content)
      .join('\n');

    const localResult = this.localDiagnose(
      combinedDescription,
      categories,
      priorities,
    );
    const diagnosis: ConversationalDiagnosis = {
      ...localResult,
      causeProbable:
        "L'IA n'est pas disponible pour le moment : voici des étapes générales à essayer avant qu'un technicien n'examine votre demande.",
      suggestedSteps: DEGRADED_SUGGESTED_STEPS,
      confidence: 0.4,
    };
    await this.recordConversationDiagnosis(
      conversationId,
      agentId,
      diagnosis,
      null,
      null,
    );
    return { status: 'DIAGNOSED', conversationId, diagnosis };
  }

  private buildDiagnosisFromEvaluation(
    evaluation: ConversationTurnEvaluation,
    categories: CategoryOption[],
    priorities: PriorityOption[],
    lastMessage: string,
    degraded: boolean,
  ): ConversationalDiagnosis {
    const category =
      categories.find((c) => c.id === evaluation.categoryId) ?? categories[0];
    const priority =
      priorities.find((p) => p.id === evaluation.priorityId) ?? priorities[0];

    return {
      title: evaluation.title?.trim() || lastMessage.slice(0, 80),
      categoryId: category.id,
      categoryName: category.name,
      priorityId: priority.id,
      priorityName: priority.name,
      degraded,
      causeProbable:
        evaluation.causeProbable?.trim() ||
        'Cause à déterminer par un technicien.',
      suggestedSteps:
        evaluation.suggestedSteps && evaluation.suggestedSteps.length > 0
          ? evaluation.suggestedSteps
          : ['Un technicien examinera votre demande.'],
      confidence: evaluation.confidence ?? 0.5,
    };
  }

  private async recordConversationDiagnosis(
    conversationId: string,
    agentId: string | null,
    diagnosis: ConversationalDiagnosis,
    responseTimeMs: number | null,
    tokenCost: number | null,
  ): Promise<void> {
    await this.prisma.aiMessage.create({
      data: {
        conversationId,
        agentId: agentId ?? undefined,
        role: AiMessageRole.AGENT,
        content:
          `Cause probable : ${diagnosis.causeProbable}\n\n` +
          `Étapes suggérées :\n${diagnosis.suggestedSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n` +
          `Catégorie : ${diagnosis.categoryName}\nPriorité : ${diagnosis.priorityName}` +
          (diagnosis.degraded ? ' (mode dégradé)' : ''),
        confidenceScore: diagnosis.confidence,
        responseTimeMs: responseTimeMs ?? undefined,
        tokenCost: tokenCost ?? undefined,
      },
    });
  }

  private async aiConverseDiagnostic(
    client: Anthropic,
    history: { role: AiMessageRole; content: string }[],
    categories: CategoryOption[],
    priorities: PriorityOption[],
    forceDiagnosis: boolean,
  ): Promise<{
    evaluation: ConversationTurnEvaluation;
    usage: Anthropic.Usage;
  }> {
    const categoryList = categories
      .map((category) => `- ${category.id}: ${category.name}`)
      .join('\n');
    const priorityList = priorities
      .map(
        (priority) =>
          `- ${priority.id}: ${priority.name} (niveau ${priority.level})`,
      )
      .join('\n');

    // Typed explicitly (rather than an inline `as` cast on the ternary
    // below) so a stray `no-unnecessary-type-assertion` autofix from
    // `npm run lint` can't silently widen the role back to `string` — see
    // the identical incident documented for roles.guard.ts.
    const messages: { role: 'user' | 'assistant'; content: string }[] =
      history.map((entry) => ({
        role: entry.role === AiMessageRole.USER ? 'user' : 'assistant',
        content: entry.content,
      }));

    const system =
      HELPDESK_SYSTEM_PROMPT +
      `\n\nCatégories disponibles :\n${categoryList}\n\n` +
      `Priorités disponibles :\n${priorityList}` +
      (forceDiagnosis
        ? '\n\nTu as déjà posé assez de questions : tu DOIS cette fois ' +
          'répondre avec needsMoreInfo=false et fournir un diagnostic, ' +
          "même si l'incertitude persiste (baisse alors le score de " +
          'confidence en conséquence).'
        : '');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 768,
      system,
      messages,
      tools: [
        {
          name: 'continue_diagnostic',
          description:
            'Pose une question de clarification, ou fournit un diagnostic complet (cause probable, étapes suggérées, catégorie, priorité, confiance)',
          input_schema: {
            type: 'object',
            properties: {
              needsMoreInfo: {
                type: 'boolean',
                description:
                  'true si une question de clarification est nécessaire avant de diagnostiquer',
              },
              question: {
                type: 'string',
                description: 'Question à poser (requis si needsMoreInfo=true)',
              },
              title: {
                type: 'string',
                description:
                  'Titre concis du problème (requis si needsMoreInfo=false)',
              },
              categoryId: {
                type: 'string',
                enum: categories.map((category) => category.id),
              },
              priorityId: {
                type: 'string',
                enum: priorities.map((priority) => priority.id),
              },
              causeProbable: {
                type: 'string',
                description: 'Cause probable (requis si needsMoreInfo=false)',
              },
              suggestedSteps: {
                type: 'array',
                items: { type: 'string' },
                description:
                  "Étapes concrètes que l'employé peut essayer lui-même (requis si needsMoreInfo=false)",
              },
              confidence: {
                type: 'number',
                description:
                  'Niveau de confiance du diagnostic, entre 0 et 1 (requis si needsMoreInfo=false)',
              },
            },
            required: ['needsMoreInfo'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'continue_diagnostic' },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw new Error(
        "Réponse de l'IA inattendue : aucune évaluation structurée reçue",
      );
    }

    return {
      evaluation: toolUse.input as ConversationTurnEvaluation,
      usage: response.usage,
    };
  }

  // docs/09-architecture-agents-ia.md §3.3 (Agent Technicien) : appelé par
  // TicketsService.assistTechnician après vérification RM-04 (technicien
  // assigné au ticket). RM-05 : indisponibilité/erreur/agent désactivé →
  // repli textuel générique, sans jamais halluciner de script (contrairement
  // aux autres agents, le repli dégradé ici ne peut pas proposer de
  // suggestedScript — un script fabriqué localement serait dangereux à
  // exécuter sans validation IA réelle).
  async assistTechnician(
    technicianId: string,
    question: string,
    context: TechnicianAssistContext,
  ): Promise<TechnicianAssistResult> {
    const conversation = await this.prisma.aiConversation.create({
      data: {
        userId: technicianId,
        provider: AiProviderName.CLAUDE,
        model: MODEL,
      },
    });
    await this.prisma.aiMessage.create({
      data: {
        conversationId: conversation.id,
        role: AiMessageRole.USER,
        content: question,
      },
    });

    const { enabled, agentId } = await this.checkAgentStatus(
      AiAgentName.TECHNICIAN,
    );

    if (!this.client || !enabled) {
      this.logger.warn(
        'Agent Technicien indisponible (clé API absente, agent ou fournisseur désactivé) : repli en mode dégradé',
      );
      return this.degradeTechnicianAssist(conversation.id, agentId);
    }

    try {
      const startedAt = Date.now();
      const { evaluation, usage } = await this.aiAssistTechnician(
        this.client,
        question,
        context,
      );
      const responseTimeMs = Date.now() - startedAt;
      const tokenCost = this.computeTokenCost(usage);

      const result: TechnicianAssistResult = {
        explanation:
          evaluation.explanation?.trim() ||
          "Aucune explication n'a pu être générée.",
        suggestedScript: evaluation.suggestedScript?.trim() || null,
        degraded: false,
        conversationId: conversation.id,
      };
      await this.recordTechnicianAssistMessage(
        conversation.id,
        agentId,
        result,
        responseTimeMs,
        tokenCost,
      );
      return result;
    } catch (error) {
      this.logger.error(
        "Échec de l'Agent Technicien, repli en mode dégradé",
        error,
      );
      return this.degradeTechnicianAssist(conversation.id, agentId);
    }
  }

  private async degradeTechnicianAssist(
    conversationId: string,
    agentId: string | null,
  ): Promise<TechnicianAssistResult> {
    const result: TechnicianAssistResult = {
      explanation:
        "L'IA n'est pas disponible pour le moment : consultez la base de " +
        "connaissances ou la documentation du fabricant avant d'intervenir.",
      suggestedScript: null,
      degraded: true,
      conversationId,
    };
    await this.recordTechnicianAssistMessage(
      conversationId,
      agentId,
      result,
      null,
      null,
    );
    return result;
  }

  private async recordTechnicianAssistMessage(
    conversationId: string,
    agentId: string | null,
    result: TechnicianAssistResult,
    responseTimeMs: number | null,
    tokenCost: number | null,
  ): Promise<void> {
    await this.prisma.aiMessage.create({
      data: {
        conversationId,
        agentId: agentId ?? undefined,
        role: AiMessageRole.AGENT,
        content:
          result.explanation +
          (result.suggestedScript
            ? `\n\nScript suggéré (non exécuté) :\n${result.suggestedScript}`
            : '') +
          (result.degraded ? ' (mode dégradé)' : ''),
        responseTimeMs: responseTimeMs ?? undefined,
        tokenCost: tokenCost ?? undefined,
      },
    });
  }

  private async aiAssistTechnician(
    client: Anthropic,
    question: string,
    context: TechnicianAssistContext,
  ): Promise<{
    evaluation: TechnicianAssistEvaluation;
    usage: Anthropic.Usage;
  }> {
    const system =
      TECHNICIAN_ASSIST_SYSTEM_PROMPT +
      `\n\nTicket concerné : ${context.ticketTitle} (catégorie : ${context.categoryName})` +
      (context.ticketSummary
        ? `\nDescription : ${context.ticketSummary}`
        : '') +
      (context.ciHistory
        ? `\n\nHistorique CMDB de l'actif concerné :\n${context.ciHistory}`
        : '') +
      (context.knowledgeExcerpts.length > 0
        ? '\n\nExtraits de documentation pertinents :\n' +
          context.knowledgeExcerpts
            .map((excerpt, i) => `${i + 1}. ${excerpt}`)
            .join('\n')
        : '');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 768,
      system,
      messages: [{ role: 'user', content: question }],
      tools: [
        {
          name: 'assist_technician',
          description:
            'Fournit une explication au technicien, avec un script ou une commande suggérée en option (jamais exécutée)',
          input_schema: {
            type: 'object',
            properties: {
              explanation: {
                type: 'string',
                description:
                  'Explication textuelle de la panne, de la commande ou de la meilleure pratique',
              },
              suggestedScript: {
                type: 'string',
                description:
                  'Script ou commande suggérée, à titre indicatif uniquement (optionnel)',
              },
            },
            required: ['explanation'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'assist_technician' },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw new Error(
        "Réponse de l'IA inattendue : aucune évaluation structurée reçue",
      );
    }

    return {
      evaluation: toolUse.input as TechnicianAssistEvaluation,
      usage: response.usage,
    };
  }

  // docs/10-architecture-rag.md §11 "Apprentissage continu" : un ticket
  // résolu génère une proposition d'article, jamais indexée automatiquement
  // (docs §11: validation humaine explicite requise avant indexation).
  async summarizeTicketForKnowledgeArticle(
    input: ResolvedTicketSummaryInput,
  ): Promise<KnowledgeArticleDraft> {
    if (
      !this.client ||
      !(await this.checkAgentStatus(AiAgentName.DOCUMENTATION)).enabled
    ) {
      this.logger.warn(
        "Agent Documentation indisponible (clé API absente, agent ou fournisseur désactivé) : proposition d'article en mode dégradé (gabarit local)",
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

  // docs/05-user-stories.md US-28. Returns null when nothing in the
  // provided catalog plausibly matches — the technician then picks a
  // script manually, exactly as before this feature existed.
  async suggestAutomationForTicket(
    ticket: TicketContextForAutomation,
    scripts: ScriptOption[],
  ): Promise<AutomationSuggestion | null> {
    if (scripts.length === 0) return null;

    if (
      !this.client ||
      !(await this.checkAgentStatus(AiAgentName.AUTOMATION)).enabled
    ) {
      this.logger.warn(
        "Agent Automation indisponible (clé API absente, agent ou fournisseur désactivé) : suggestion d'automatisation en mode dégradé (mots-clés locaux)",
      );
      return this.localSuggestAutomation(ticket, scripts);
    }

    try {
      return await this.aiSuggestAutomation(this.client, ticket, scripts);
    } catch (error) {
      this.logger.error(
        "Échec de la suggestion IA d'automatisation, repli en mode dégradé (mots-clés locaux)",
        error,
      );
      return this.localSuggestAutomation(ticket, scripts);
    }
  }

  private async aiSuggestAutomation(
    client: Anthropic,
    ticket: TicketContextForAutomation,
    scripts: ScriptOption[],
  ): Promise<AutomationSuggestion | null> {
    const scriptList = scripts
      .map((script) => `- ${script.id}: ${script.name} — ${script.content}`)
      .join('\n');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: AUTOMATION_SUGGESTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Titre du ticket : ${ticket.title}\n` +
            `Catégorie : ${ticket.categoryName}\n` +
            `Description : ${ticket.summary ?? '(non fournie)'}\n\n` +
            `Scripts disponibles :\n${scriptList}`,
        },
      ],
      tools: [
        {
          name: 'suggest_automation_script',
          description:
            'Indique le script d\'automatisation le plus pertinent pour ce ticket, ou "aucun"',
          input_schema: {
            type: 'object',
            properties: {
              scriptId: {
                type: 'string',
                enum: [...scripts.map((script) => script.id), NO_SUGGESTION],
                description:
                  'L\'identifiant du script le plus pertinent, ou "aucun" si rien ne correspond',
              },
              justification: {
                type: 'string',
                description:
                  'Justification courte et factuelle basée sur le ticket (vide si scriptId est "aucun")',
              },
            },
            required: ['scriptId', 'justification'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'suggest_automation_script' },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw new Error(
        "Réponse de l'IA inattendue : aucune suggestion structurée reçue",
      );
    }

    const suggestion = toolUse.input as AutomationSuggestionResponse;

    if (
      !suggestion.scriptId ||
      suggestion.scriptId === NO_SUGGESTION ||
      !scripts.some((script) => script.id === suggestion.scriptId)
    ) {
      return null;
    }

    return {
      scriptId: suggestion.scriptId,
      justification: suggestion.justification?.trim() || ticket.title,
      degraded: false,
    };
  }

  private localSuggestAutomation(
    ticket: TicketContextForAutomation,
    scripts: ScriptOption[],
  ): AutomationSuggestion | null {
    const normalizedText = normalize(`${ticket.title} ${ticket.summary ?? ''}`);

    let best: ScriptOption | null = null;
    let bestScore = 0;

    for (const script of scripts) {
      const words = normalize(script.name)
        .split(/\W+/)
        .filter((word) => word.length >= 4);
      const score = countMatches(normalizedText, words);
      if (score > bestScore) {
        best = script;
        bestScore = score;
      }
    }

    if (!best) return null;

    return {
      scriptId: best.id,
      justification: ticket.summary?.trim() || ticket.title,
      degraded: true,
    };
  }

  // docs/06-cas-utilisation.md UC-015, RM-03 : contrairement aux autres
  // agents, il n'y a PAS de repli en mode dégradé ici — un heuristique local
  // par mots-clés ne peut jamais affirmer de façon fiable un niveau de
  // confiance de 95%, et prétendre le contraire serait dangereux (RM-03
  // exige une confiance réelle avant toute action non supervisée). Si l'IA
  // est indisponible, désactivée, ou échoue, la résolution automatique
  // n'est simplement jamais proposée — le diagnostic conversationnel
  // standard (RM-05) prend le relais normalement.
  async attemptAutoResolution(
    description: string,
    nonSensitiveScripts: ScriptOption[],
  ): Promise<AutoResolutionSuggestion | null> {
    if (nonSensitiveScripts.length === 0) return null;

    if (
      !this.client ||
      !(await this.checkAgentStatus(AiAgentName.AUTOMATION)).enabled
    ) {
      this.logger.warn(
        'Agent Automation indisponible : aucune résolution automatique proposée (UC-015 ne se dégrade jamais, RM-03)',
      );
      return null;
    }

    try {
      return await this.aiAttemptAutoResolution(
        this.client,
        description,
        nonSensitiveScripts,
      );
    } catch (error) {
      this.logger.error(
        "Échec de l'évaluation de résolution automatique, aucune proposition (UC-015)",
        error,
      );
      return null;
    }
  }

  private async aiAttemptAutoResolution(
    client: Anthropic,
    description: string,
    nonSensitiveScripts: ScriptOption[],
  ): Promise<AutoResolutionSuggestion | null> {
    const scriptList = nonSensitiveScripts
      .map((script) => `- ${script.id}: ${script.name} — ${script.content}`)
      .join('\n');

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: AUTO_RESOLUTION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content:
            `Description du problème :\n"""\n${description}\n"""\n\n` +
            `Scripts non sensibles disponibles :\n${scriptList}`,
        },
      ],
      tools: [
        {
          name: 'evaluate_auto_resolution',
          description:
            'Évalue si ce problème peut être résolu automatiquement par un script non sensible',
          input_schema: {
            type: 'object',
            properties: {
              eligible: {
                type: 'boolean',
                description:
                  'true seulement si un script correspond clairement avec une confiance >= 0.95',
              },
              scriptId: {
                type: 'string',
                enum: nonSensitiveScripts.map((script) => script.id),
                description: 'Requis si eligible=true',
              },
              confidence: {
                type: 'number',
                description: 'Niveau de confiance entre 0 et 1',
              },
              explanation: {
                type: 'string',
                description:
                  "Explication courte et factuelle de l'action qui serait prise",
              },
            },
            required: ['eligible'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'evaluate_auto_resolution' },
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (!toolUse) {
      throw new Error(
        "Réponse de l'IA inattendue : aucune évaluation structurée reçue",
      );
    }

    const evaluation = toolUse.input as AutoResolutionEvaluation;

    if (
      !evaluation.eligible ||
      !evaluation.scriptId ||
      (evaluation.confidence ?? 0) < 0.95 ||
      !nonSensitiveScripts.some((script) => script.id === evaluation.scriptId)
    ) {
      return null;
    }

    return {
      scriptId: evaluation.scriptId,
      confidence: evaluation.confidence ?? 0.95,
      explanation: evaluation.explanation?.trim() || '',
    };
  }
}
