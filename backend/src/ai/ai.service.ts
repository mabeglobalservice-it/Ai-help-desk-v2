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

export interface TicketDiagnosis {
  title: string;
  categoryId: string;
  categoryName: string;
  priorityId: string;
  priorityName: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly client = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  constructor(private readonly prisma: PrismaService) {}

  async diagnoseTicket(description: string): Promise<TicketDiagnosis> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        "L'analyse IA n'est pas configurée pour le moment.",
      );
    }

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

    const categoryList = categories
      .map((category) => `- ${category.id}: ${category.name}`)
      .join('\n');
    const priorityList = priorities
      .map(
        (priority) =>
          `- ${priority.id}: ${priority.name} (niveau ${priority.level})`,
      )
      .join('\n');

    try {
      const response = await this.client.messages.create({
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
      };
    } catch (error) {
      this.logger.error("Échec de l'analyse IA", error);
      throw new ServiceUnavailableException(
        "Impossible d'analyser la description pour le moment.",
      );
    }
  }
}
