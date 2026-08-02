import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AiService', () => {
  let service: AiService;
  let prisma: {
    ticketCategory: { findMany: jest.Mock };
    priority: { findMany: jest.Mock };
    aiAgent: { findUnique: jest.Mock };
    aiProviderConfig: { findUnique: jest.Mock };
    aiConversation: { create: jest.Mock };
    aiMessage: { create: jest.Mock };
  };
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  async function buildService(): Promise<AiService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    return module.get(AiService);
  }

  beforeEach(async () => {
    // docs/06-cas-utilisation.md RM-05: exercises the degraded (no API key)
    // fallback path deterministically, without depending on network access
    // or real credentials being present in the test environment.
    delete process.env.ANTHROPIC_API_KEY;

    prisma = {
      ticketCategory: { findMany: jest.fn() },
      priority: { findMany: jest.fn() },
      // docs/11-documentation-api.md §6: absent by default (no seeded row)
      // is treated as "enabled", matching AiService's fallback default —
      // tests that need a disabled agent/provider override this explicitly.
      aiAgent: { findUnique: jest.fn().mockResolvedValue(null) },
      aiProviderConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      aiConversation: {
        create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
      },
      aiMessage: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
    };

    service = await buildService();
  });

  afterEach(() => {
    if (originalApiKey) process.env.ANTHROPIC_API_KEY = originalApiKey;
    else delete process.env.ANTHROPIC_API_KEY;
  });

  describe('diagnoseTicket', () => {
    const categories = [
      { id: 'cat-materiel', name: 'Matériel' },
      { id: 'cat-logiciel', name: 'Logiciel' },
    ];
    const priorities = [
      { id: 'prio-faible', name: 'Faible', level: 1 },
      { id: 'prio-urgente', name: 'Urgente', level: 3 },
    ];

    beforeEach(() => {
      prisma.ticketCategory.findMany.mockResolvedValue(categories);
      prisma.priority.findMany.mockResolvedValue(priorities);
    });

    it('falls back to local keyword diagnosis when no API key is configured', async () => {
      const result = await service.diagnoseTicket(
        "L'imprimante ne s'allume plus depuis ce matin",
        'user-1',
      );

      expect(result.degraded).toBe(true);
      expect(result.categoryId).toBe('cat-materiel');
      expect(result.conversationId).toBe('conv-1');
      expect(prisma.aiConversation.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          provider: 'CLAUDE',
          model: 'claude-sonnet-5',
        },
      });
    });

    // docs/11-documentation-api.md §6 : agent désactivé par un Admin.
    it('falls back to local keyword diagnosis when the Diagnostic agent is disabled, even with an API key configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
      prisma.aiAgent.findUnique.mockResolvedValue({ isActive: false });
      prisma.aiProviderConfig.findUnique.mockResolvedValue({ isActive: true });
      service = await buildService();

      const result = await service.diagnoseTicket(
        'Problème quelconque',
        'user-1',
      );

      expect(result.degraded).toBe(true);
      expect(prisma.aiAgent.findUnique).toHaveBeenCalledWith({
        where: { name: 'DIAGNOSTIC' },
      });
    });
  });

  describe('summarizeTicketForKnowledgeArticle', () => {
    it('falls back to a local template draft when no API key is configured', async () => {
      const draft = await service.summarizeTicketForKnowledgeArticle({
        title: 'Imprimante réseau bloquée',
        summary: 'Les travaux ne sortent plus depuis ce matin.',
        resolutionNote: 'Redémarrage du service de spouleur.',
        categoryName: 'Matériel',
      });

      expect(draft.degraded).toBe(true);
      expect(draft.title).toBe('Imprimante réseau bloquée');
      expect(draft.content).toContain('Cause probable');
      expect(draft.content).toContain(
        'Les travaux ne sortent plus depuis ce matin.',
      );
      expect(draft.content).toContain('Solution appliquée');
      expect(draft.content).toContain('Redémarrage du service de spouleur.');
    });

    it('handles missing summary/resolutionNote gracefully in the fallback', async () => {
      const draft = await service.summarizeTicketForKnowledgeArticle({
        title: 'Ticket sans détails',
        summary: null,
        resolutionNote: null,
        categoryName: 'Logiciel',
      });

      expect(draft.degraded).toBe(true);
      expect(draft.content).toContain('(non renseignée)');
    });

    // docs/11-documentation-api.md §6 : un Admin peut désactiver l'agent
    // Documentation même quand une clé API valide est configurée.
    it('falls back to the local template when the Documentation agent is disabled, even with an API key configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
      prisma.aiAgent.findUnique.mockResolvedValue({ isActive: false });
      prisma.aiProviderConfig.findUnique.mockResolvedValue({ isActive: true });
      service = await buildService();

      const draft = await service.summarizeTicketForKnowledgeArticle({
        title: 'Ticket test',
        summary: 'Résumé',
        resolutionNote: 'Résolution',
        categoryName: 'Matériel',
      });

      expect(draft.degraded).toBe(true);
      expect(prisma.aiAgent.findUnique).toHaveBeenCalledWith({
        where: { name: 'DOCUMENTATION' },
      });
    });
  });

  // docs/05-user-stories.md US-28
  describe('suggestAutomationForTicket', () => {
    const scripts = [
      {
        id: 'script-dns',
        name: 'Vider le cache DNS',
        content: 'Clear-DnsClientCache',
      },
      {
        id: 'script-password',
        name: 'Réinitialiser le mot de passe',
        content: 'Set-ADAccountPassword',
      },
    ];

    it('returns null immediately when no scripts are available', async () => {
      const result = await service.suggestAutomationForTicket(
        { title: 'Compte verrouillé', summary: null, categoryName: 'Accès' },
        [],
      );

      expect(result).toBeNull();
    });

    it('matches the script whose name overlaps with the ticket text (degraded mode)', async () => {
      const result = await service.suggestAutomationForTicket(
        {
          title: 'Mot de passe oublié, compte verrouillé',
          summary: 'Utilisateur bloqué après plusieurs tentatives',
          categoryName: 'Accès',
        },
        scripts,
      );

      expect(result).not.toBeNull();
      expect(result?.scriptId).toBe('script-password');
      expect(result?.degraded).toBe(true);
    });

    // docs/11-documentation-api.md §6 : basculer le fournisseur actif sur
    // autre chose que CLAUDE force le mode dégradé, même avec une clé API.
    it('falls back to keyword matching when the active provider is not CLAUDE, even with an API key configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
      prisma.aiAgent.findUnique.mockResolvedValue({ isActive: true });
      prisma.aiProviderConfig.findUnique.mockResolvedValue({ isActive: false });
      service = await buildService();

      const result = await service.suggestAutomationForTicket(
        {
          title: 'Mot de passe oublié, compte verrouillé',
          summary: 'Utilisateur bloqué après plusieurs tentatives',
          categoryName: 'Accès',
        },
        scripts,
      );

      expect(result?.degraded).toBe(true);
      expect(prisma.aiProviderConfig.findUnique).toHaveBeenCalledWith({
        where: { provider: 'CLAUDE' },
      });
    });

    it('returns null when nothing in the ticket text overlaps with any script name', async () => {
      const result = await service.suggestAutomationForTicket(
        {
          title: 'Question générale sur la politique de télétravail',
          summary: null,
          categoryName: 'Logiciel',
        },
        scripts,
      );

      expect(result).toBeNull();
    });
  });
});
