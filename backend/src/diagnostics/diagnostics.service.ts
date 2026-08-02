import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiMessageRole } from '../../generated/prisma/client';
import { AddFeedbackDto } from './dto/add-feedback.dto';

// docs/11-documentation-api.md §5 : historique et retour d'utilité d'une
// conversation de diagnostic (docs/08 §4.4). Le module Diagnostics existant
// (POST /tickets/ai-diagnose) reste inchangé pour ne pas casser le front
// existant ; ce module ajoute uniquement les routes de lecture/feedback qui
// manquaient encore.
@Injectable()
export class DiagnosticsService {
  constructor(private readonly prisma: PrismaService) {}

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
