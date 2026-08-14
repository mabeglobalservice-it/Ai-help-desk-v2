import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiMessageRole, AiProviderName } from '../../generated/prisma/client';

// Seul CLAUDE a une intégration réelle (voir AiService.checkAgentStatus,
// src/ai/ai.service.ts, qui vérifie spécifiquement ce fournisseur) —
// OPENAI/AZURE_OPENAI existent dans l'enum et sont sélectionnables (RM-05 :
// un Admin peut vouloir forcer le mode dégradé délibérément), mais les
// choisir désactive l'IA pour tous les agents plutôt que d'appeler ce
// fournisseur. Cette liste n'alimente que l'indicateur `isImplemented`
// ci-dessous (administration) ; `checkAgentStatus` reste la source de
// vérité pour l'exécution réelle et n'est pas dérivée d'ici pour ne pas
// risquer de modifier son comportement, largement couvert par des tests.
const IMPLEMENTED_AI_PROVIDERS: readonly AiProviderName[] = [
  AiProviderName.CLAUDE,
];

// docs/11-documentation-api.md §6, docs/09-architecture-agents-ia.md §3 :
// administration du registre des agents IA et du fournisseur actif,
// séparée de AiService (qui exécute les agents) pour garder l'exécution
// et l'administration découplées.
@Injectable()
export class AiAgentsService {
  constructor(private readonly prisma: PrismaService) {}

  findAllAgents() {
    return this.prisma.aiAgent.findMany({ orderBy: { name: 'asc' } });
  }

  async toggleAgent(id: string) {
    const agent = await this.prisma.aiAgent.findUnique({ where: { id } });
    if (!agent) {
      throw new NotFoundException(`Agent IA ${id} introuvable`);
    }

    return this.prisma.aiAgent.update({
      where: { id },
      data: { isActive: !agent.isActive },
    });
  }

  // docs/11-documentation-api.md §6 : `isImplemented` permet à l'UI admin
  // de distinguer clairement les fournisseurs réellement fonctionnels de
  // ceux qui existent dans l'enum mais dégradent tout (RM-05) — voir
  // IMPLEMENTED_AI_PROVIDERS ci-dessus. Sans ce champ, l'écran
  // /admin/ai-agents ne pouvait montrer cette distinction que dans un
  // paragraphe de description, pas au niveau de chaque ligne, ni avant de
  // confirmer une activation.
  private withImplementedFlag<T extends { provider: AiProviderName }>(
    config: T,
  ): T & { isImplemented: boolean } {
    return {
      ...config,
      isImplemented: IMPLEMENTED_AI_PROVIDERS.includes(config.provider),
    };
  }

  async findAllProviders() {
    const configs = await this.prisma.aiProviderConfig.findMany({
      orderBy: { provider: 'asc' },
    });
    return configs.map((config) => this.withImplementedFlag(config));
  }

  // Un seul fournisseur actif à la fois : les deux écritures sont groupées
  // dans une transaction pour ne jamais laisser aucun fournisseur actif en
  // cas d'échec partiel.
  async setActiveProvider(provider: AiProviderName) {
    const existing = await this.prisma.aiProviderConfig.findUnique({
      where: { provider },
    });
    if (!existing) {
      throw new NotFoundException(`Fournisseur IA ${provider} introuvable`);
    }

    const [, updated] = await this.prisma.$transaction([
      this.prisma.aiProviderConfig.updateMany({
        where: { provider: { not: provider } },
        data: { isActive: false },
      }),
      this.prisma.aiProviderConfig.update({
        where: { provider },
        data: { isActive: true },
      }),
    ]);

    return this.withImplementedFlag(updated);
  }

  // docs/11-documentation-api.md §6 "GET /ai/conversations/:id/cost" :
  // coût cumulé (tokens) d'une conversation de diagnostic, réservé au
  // superviseur/admin. Le coût n'est disponible que sur les messages issus
  // d'un appel réel au fournisseur IA (docs/08 §4.4) — les réponses en mode
  // dégradé (RM-05) ont un tokenCost nul et ne comptent pas dans le total.
  async getConversationCost(conversationId: string) {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} introuvable`);
    }

    const agentMessages = conversation.messages.filter(
      (message) => message.role === AiMessageRole.AGENT,
    );
    const totalTokenCost = agentMessages.reduce(
      (sum, message) =>
        sum + (message.tokenCost ? Number(message.tokenCost) : 0),
      0,
    );

    return {
      conversationId: conversation.id,
      provider: conversation.provider,
      model: conversation.model,
      callCount: agentMessages.length,
      totalTokenCost,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        role: message.role,
        responseTimeMs: message.responseTimeMs,
        tokenCost: message.tokenCost ? Number(message.tokenCost) : null,
        createdAt: message.createdAt,
      })),
    };
  }
}
