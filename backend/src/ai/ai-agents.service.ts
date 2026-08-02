import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiProviderName } from '../../generated/prisma/client';

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

  findAllProviders() {
    return this.prisma.aiProviderConfig.findMany({
      orderBy: { provider: 'asc' },
    });
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

    return updated;
  }
}
