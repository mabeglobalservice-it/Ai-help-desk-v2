import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiConversationStatus,
  AiMessageRole,
} from '../../generated/prisma/client';
import { AiService } from '../ai/ai.service';
import { AddFeedbackDto } from './dto/add-feedback.dto';
import { StartDiagnosticDto } from './dto/start-diagnostic.dto';
import { ResolveDiagnosticDto } from './dto/resolve-diagnostic.dto';

// docs/11-documentation-api.md §5 : soumission (POST /diagnostics),
// historique et retour d'utilité d'une conversation de diagnostic (docs/08
// §4.4). Le module ai-diagnose existant (POST /tickets/ai-diagnose) reste
// inchangé pour ne pas casser le pré-remplissage rapide déjà en place ;
// POST /diagnostics est le nouveau point d'entrée conversationnel
// multi-tour (docs/09 §3.2, Agent Help Desk).
@Injectable()
export class DiagnosticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

  // docs/06-cas-utilisation.md UC-001 étapes 1-6.
  startOrContinue(userId: string, dto: StartDiagnosticDto) {
    return this.aiService.converseDiagnostic(
      dto.conversationId ?? null,
      userId,
      dto.message,
    );
  }

  // docs/06-cas-utilisation.md UC-001 étape 6 ("l'utilisateur confirme que
  // le problème persiste"). resolved=true : le problème est résolu par les
  // étapes suggérées (US-02), aucun ticket n'est nécessaire. resolved=false
  // : la conversation reste ONGOING — la création du ticket (POST /tickets
  // avec conversationId) est ce qui la fait passer à ESCALATED, voir
  // TicketsService.create.
  async resolveConversation(
    conversationId: string,
    userId: string,
    dto: ResolveDiagnosticDto,
  ) {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.userId !== userId) {
      throw new NotFoundException(`Conversation ${conversationId} introuvable`);
    }
    if (conversation.status !== AiConversationStatus.ONGOING) {
      throw new BadRequestException('Cette conversation est déjà terminée');
    }

    if (!dto.resolved) {
      await this.prisma.aiMessage.create({
        data: {
          conversationId,
          role: AiMessageRole.USER,
          content: 'Le problème persiste, création d’un ticket.',
        },
      });
      return { status: 'PERSISTS' as const };
    }

    await this.prisma.$transaction([
      this.prisma.aiConversation.update({
        where: { id: conversationId },
        data: { status: AiConversationStatus.RESOLVED },
      }),
      this.prisma.aiMessage.create({
        data: {
          conversationId,
          role: AiMessageRole.USER,
          content: 'Le problème est résolu, aucun ticket nécessaire.',
        },
      }),
    ]);
    return { status: 'RESOLVED' as const };
  }

  async getConversation(conversationId: string, requesterId: string) {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} introuvable`);
    }
    if (conversation.userId !== requesterId) {
      throw new ForbiddenException(
        "Vous n'avez pas accès à cette conversation",
      );
    }

    return conversation;
  }

  // docs/11 §5 : le feedback est rattaché au dernier message de l'agent —
  // c'est la seule réponse dont un technicien peut juger l'utilité.
  async addFeedback(
    conversationId: string,
    technicianId: string,
    dto: AddFeedbackDto,
  ) {
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          where: { role: AiMessageRole.AGENT },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} introuvable`);
    }
    const lastAgentMessage = conversation.messages[0];
    if (!lastAgentMessage) {
      throw new NotFoundException(
        "Cette conversation n'a aucune réponse de l'agent",
      );
    }

    return this.prisma.aiFeedback.create({
      data: {
        messageId: lastAgentMessage.id,
        technicianId,
        wasHelpful: dto.wasHelpful,
        comment: dto.comment,
      },
    });
  }
}
