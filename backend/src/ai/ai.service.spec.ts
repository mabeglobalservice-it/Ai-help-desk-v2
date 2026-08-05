import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiConversationStatus } from '../../generated/prisma/client';
import {
  queueAnthropicError,
  queueAnthropicResponse,
  resetAnthropicMock,
  toolUseResponse,
} from '../../test/support/anthropic-mock';

// docs/09-architecture-agents-ia.md: every agent's real-Claude tool-use
// response parsing is exercised here via a mocked Anthropic SDK (see
// test/support/anthropic-mock.ts and the root README "Tests" section) —
// no unit test ever calls the real API, so this suite never spends credits
// or depends on network access.
jest.mock('@anthropic-ai/sdk', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../test/support/anthropic-mock').anthropicSdkMockFactory(),
);

describe('AiService', () => {
  let service: AiService;
  let prisma: {
    ticketCategory: { findMany: jest.Mock };
    priority: { findMany: jest.Mock };
    aiAgent: { findUnique: jest.Mock };
    aiProviderConfig: { findUnique: jest.Mock };
    aiConversation: { create: jest.Mock; findUnique: jest.Mock };
    aiMessage: { create: jest.Mock };
    systemSettings: { findUnique: jest.Mock };
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
    resetAnthropicMock();

    prisma = {
      ticketCategory: { findMany: jest.fn() },
      priority: { findMany: jest.fn() },
      // docs/11-documentation-api.md §6: absent by default (no seeded row)
      // is treated as "enabled", matching AiService's fallback default —
      // tests that need a disabled agent/provider override this explicitly.
      aiAgent: { findUnique: jest.fn().mockResolvedValue(null) },
      aiProviderConfig: { findUnique: jest.fn().mockResolvedValue(null) },
      aiConversation: {
        create: jest.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
        findUnique: jest.fn(),
      },
      aiMessage: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
      // docs/11-documentation-api.md §12: absent by default (no seeded
      // row) falls back to DEFAULT_MAX_CLARIFYING_TURNS.
      systemSettings: { findUnique: jest.fn().mockResolvedValue(null) },
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

    // Real-Claude path, mocked Anthropic SDK (see test/support/anthropic-mock.ts).
    describe('with the AI provider available (mocked)', () => {
      beforeEach(async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
        service = await buildService();
      });

      it('detects the category confidently from a clear description', async () => {
        queueAnthropicResponse(
          toolUseResponse('suggest_ticket_details', {
            title: 'Connexion VPN impossible',
            categoryId: 'cat-logiciel',
            priorityId: 'prio-urgente',
          }),
        );

        const result = await service.diagnoseTicket(
          "Impossible de me connecter au VPN depuis ce matin, toute l'équipe est bloquée",
          'user-1',
        );

        expect(result.degraded).toBe(false);
        expect(result.categoryId).toBe('cat-logiciel');
        expect(result.priorityId).toBe('prio-urgente');
        expect(result.title).toBe('Connexion VPN impossible');
      });

      it('falls back to local keyword diagnosis when the AI call errors or times out', async () => {
        queueAnthropicError();

        const result = await service.diagnoseTicket(
          "L'imprimante ne s'allume plus depuis ce matin",
          'user-1',
        );

        expect(result.degraded).toBe(true);
        expect(result.categoryId).toBe('cat-materiel');
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

    // Real-Claude path, mocked Anthropic SDK (see test/support/anthropic-mock.ts).
    describe('with the AI provider available (mocked)', () => {
      beforeEach(async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
        service = await buildService();
      });

      it('generates an article via the AI provider', async () => {
        queueAnthropicResponse(
          toolUseResponse('propose_knowledge_article', {
            title: 'Résoudre un blocage du service de spouleur',
            content:
              'Cause probable : le service de spouleur se bloque après une mise à jour.\n' +
              'Solution appliquée : redémarrer le service de spouleur.',
          }),
        );

        const draft = await service.summarizeTicketForKnowledgeArticle({
          title: 'Imprimante réseau bloquée',
          summary: 'Les travaux ne sortent plus depuis ce matin.',
          resolutionNote: 'Redémarrage du service de spouleur.',
          categoryName: 'Matériel',
        });

        expect(draft.degraded).toBe(false);
        expect(draft.title).toBe('Résoudre un blocage du service de spouleur');
        expect(draft.content).toContain('Solution appliquée');
      });

      it('falls back to the local template when the AI call errors or times out', async () => {
        queueAnthropicError();

        const draft = await service.summarizeTicketForKnowledgeArticle({
          title: 'Imprimante réseau bloquée',
          summary: 'Les travaux ne sortent plus depuis ce matin.',
          resolutionNote: 'Redémarrage du service de spouleur.',
          categoryName: 'Matériel',
        });

        expect(draft.degraded).toBe(true);
        expect(draft.content).toContain('Cause probable');
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

    // Real-Claude path, mocked Anthropic SDK (see test/support/anthropic-mock.ts).
    describe('with the AI provider available (mocked)', () => {
      beforeEach(async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
        service = await buildService();
      });

      it('suggests a script via the AI provider', async () => {
        queueAnthropicResponse(
          toolUseResponse('suggest_automation_script', {
            scriptId: 'script-dns',
            justification: 'Le ticket décrit un échec de résolution DNS.',
          }),
        );

        const result = await service.suggestAutomationForTicket(
          {
            title: 'Sites web inaccessibles',
            summary: 'Erreur "serveur introuvable" sur tous les sites',
            categoryName: 'Réseau',
          },
          scripts,
        );

        expect(result?.degraded).toBe(false);
        expect(result?.scriptId).toBe('script-dns');
      });

      it('returns null when the AI provider finds no script matching (ambiguous ticket)', async () => {
        queueAnthropicResponse(
          toolUseResponse('suggest_automation_script', {
            scriptId: 'aucun',
            justification: '',
          }),
        );

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

      it('falls back to keyword matching when the AI call errors or times out', async () => {
        queueAnthropicError();

        const result = await service.suggestAutomationForTicket(
          {
            title: 'Mot de passe oublié, compte verrouillé',
            summary: 'Utilisateur bloqué après plusieurs tentatives',
            categoryName: 'Accès',
          },
          scripts,
        );

        expect(result?.degraded).toBe(true);
        expect(result?.scriptId).toBe('script-password');
      });
    });
  });

  // docs/06-cas-utilisation.md UC-015, RM-03 : contrairement aux autres
  // agents, il n'y a jamais de mode dégradé actif ici — un heuristique
  // local ne peut pas affirmer une confiance >= 95% de façon fiable.
  describe('attemptAutoResolution', () => {
    const nonSensitiveScripts = [
      {
        id: 'script-cache',
        name: 'Vider le cache imprimante',
        content: 'Clear-PrintSpooler',
      },
    ];

    it('returns null immediately when no non-sensitive scripts are available', async () => {
      const result = await service.attemptAutoResolution(
        'Imprimante bloquée',
        [],
      );

      expect(result).toBeNull();
    });

    it('never proposes a resolution when no API key is configured (no degraded mode for UC-015)', async () => {
      const result = await service.attemptAutoResolution(
        'Imprimante bloquée, redémarrage du spouleur nécessaire',
        nonSensitiveScripts,
      );

      expect(result).toBeNull();
    });

    it('never proposes a resolution when the Automation agent is disabled, even with an API key configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
      prisma.aiAgent.findUnique.mockResolvedValue({ isActive: false });
      prisma.aiProviderConfig.findUnique.mockResolvedValue({ isActive: true });
      service = await buildService();

      const result = await service.attemptAutoResolution(
        'Imprimante bloquée',
        nonSensitiveScripts,
      );

      expect(result).toBeNull();
      expect(prisma.aiAgent.findUnique).toHaveBeenCalledWith({
        where: { name: 'AUTOMATION' },
      });
    });

    // Real-Claude path, mocked Anthropic SDK (see test/support/anthropic-mock.ts).
    describe('with the AI provider available (mocked)', () => {
      beforeEach(async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
        service = await buildService();
      });

      it('proposes auto-resolution when the AI provider reports confidence >= 0.95', async () => {
        queueAnthropicResponse(
          toolUseResponse('evaluate_auto_resolution', {
            eligible: true,
            scriptId: 'script-cache',
            confidence: 0.98,
            explanation:
              'Le cache imprimante correspond exactement au problème décrit.',
          }),
        );

        const result = await service.attemptAutoResolution(
          'Imprimante bloquée, redémarrage du spouleur nécessaire',
          nonSensitiveScripts,
        );

        expect(result).not.toBeNull();
        expect(result?.scriptId).toBe('script-cache');
        expect(result?.confidence).toBeGreaterThanOrEqual(0.95);
      });

      // docs/06-cas-utilisation.md RM-03 : le seuil de 95% est vérifié
      // côté serveur, jamais délégué à la seule affirmation du modèle.
      it("never proposes a resolution when the AI provider's confidence is below 0.95 (RM-03)", async () => {
        queueAnthropicResponse(
          toolUseResponse('evaluate_auto_resolution', {
            eligible: true,
            scriptId: 'script-cache',
            confidence: 0.8,
            explanation: 'Correspondance plausible mais incertaine.',
          }),
        );

        const result = await service.attemptAutoResolution(
          'Imprimante bloquée',
          nonSensitiveScripts,
        );

        expect(result).toBeNull();
      });

      it('falls back to no proposal when the AI call errors or times out', async () => {
        queueAnthropicError();

        const result = await service.attemptAutoResolution(
          'Imprimante bloquée, redémarrage du spouleur nécessaire',
          nonSensitiveScripts,
        );

        expect(result).toBeNull();
      });
    });
  });

  // docs/06-cas-utilisation.md UC-001, docs/09-architecture-agents-ia.md §3.2
  // (Agent Help Desk). Covers both the degraded-mode path (no API key) and
  // the ownership/status guards in getOrStartConversation; the real-Claude
  // tool-use path (mocked Anthropic SDK) is covered separately below.
  describe('converseDiagnostic', () => {
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

    it('starts a new conversation and immediately returns a degraded diagnosis when no API key is configured (never asks a question)', async () => {
      const result = await service.converseDiagnostic(
        null,
        'user-1',
        "L'imprimante ne s'allume plus depuis ce matin",
      );

      expect(prisma.aiConversation.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          provider: 'CLAUDE',
          model: 'claude-sonnet-5',
        },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(result.status).toBe('DIAGNOSED');
      if (result.status !== 'DIAGNOSED') return;
      expect(result.diagnosis.degraded).toBe(true);
      expect(result.diagnosis.categoryId).toBe('cat-materiel');
      expect(result.diagnosis.confidence).toBe(0.4);
      expect(result.diagnosis.suggestedSteps.length).toBeGreaterThan(0);
    });

    it('continues an existing ongoing conversation using its prior history', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        status: AiConversationStatus.ONGOING,
        messages: [{ role: 'USER', content: 'Mon PC ne démarre plus' }],
      });

      const result = await service.converseDiagnostic(
        'conv-1',
        'user-1',
        'Windows 11',
      );

      expect(prisma.aiConversation.findUnique).toHaveBeenCalledWith({
        where: { id: 'conv-1' },
        include: { messages: { orderBy: { createdAt: 'asc' } } },
      });
      expect(result.status).toBe('DIAGNOSED');
      expect(result.conversationId).toBe('conv-1');
    });

    it('throws NotFoundException when the conversation does not exist', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue(null);

      await expect(
        service.converseDiagnostic('conv-missing', 'user-1', 'oui'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the conversation belongs to another user', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-2',
        status: AiConversationStatus.ONGOING,
        messages: [],
      });

      await expect(
        service.converseDiagnostic('conv-1', 'user-1', 'oui'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the conversation is already terminated', async () => {
      prisma.aiConversation.findUnique.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        status: AiConversationStatus.RESOLVED,
        messages: [],
      });

      await expect(
        service.converseDiagnostic('conv-1', 'user-1', 'oui'),
      ).rejects.toThrow(BadRequestException);
    });

    it('records the degraded diagnosis as an AGENT message on the conversation', async () => {
      await service.converseDiagnostic(null, 'user-1', 'Problème quelconque');

      expect(prisma.aiMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-1',
            role: 'AGENT',
            confidenceScore: 0.4,
          }) as unknown,
        }),
      );
    });

    it('falls back to the degraded diagnosis when the Help Desk agent is disabled, even with an API key configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
      prisma.aiAgent.findUnique.mockResolvedValue({ isActive: false });
      prisma.aiProviderConfig.findUnique.mockResolvedValue({ isActive: true });
      service = await buildService();

      const result = await service.converseDiagnostic(
        null,
        'user-1',
        'Problème quelconque',
      );

      expect(result.status).toBe('DIAGNOSED');
      expect(prisma.aiAgent.findUnique).toHaveBeenCalledWith({
        where: { name: 'HELPDESK' },
      });
    });

    // Real-Claude path, mocked Anthropic SDK (see test/support/anthropic-mock.ts).
    describe('with the AI provider available (mocked)', () => {
      beforeEach(async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
        service = await buildService();
      });

      it('returns a high-confidence diagnosis directly from the AI provider', async () => {
        queueAnthropicResponse(
          toolUseResponse('continue_diagnostic', {
            needsMoreInfo: false,
            title: 'Écran bleu au démarrage',
            categoryId: 'cat-materiel',
            priorityId: 'prio-urgente',
            causeProbable: 'Pilote graphique corrompu après une mise à jour.',
            suggestedSteps: [
              'Redémarrer en mode sans échec',
              'Revenir à la version précédente du pilote',
            ],
            confidence: 0.92,
          }),
        );

        const result = await service.converseDiagnostic(
          null,
          'user-1',
          'Écran bleu à chaque démarrage depuis la mise à jour Windows',
        );

        expect(result.status).toBe('DIAGNOSED');
        if (result.status !== 'DIAGNOSED') return;
        expect(result.diagnosis.degraded).toBe(false);
        expect(result.diagnosis.confidence).toBeGreaterThanOrEqual(0.9);
        expect(result.diagnosis.categoryId).toBe('cat-materiel');
      });

      // Couvre à la fois "faible confiance" et "catégorie ambiguë" : le
      // modèle préfère poser une question plutôt que de deviner.
      it('asks a clarifying question when the problem is ambiguous / confidence would be low', async () => {
        queueAnthropicResponse(
          toolUseResponse('continue_diagnostic', {
            needsMoreInfo: true,
            question: 'Le problème concerne-t-il un seul poste ou plusieurs ?',
          }),
        );

        const result = await service.converseDiagnostic(
          null,
          'user-1',
          'Ça ne marche pas',
        );

        expect(result.status).toBe('NEEDS_INFO');
        if (result.status !== 'NEEDS_INFO') return;
        expect(result.question).toContain('poste');
      });

      it('falls back to a degraded diagnosis when the AI call errors or times out', async () => {
        queueAnthropicError();

        const result = await service.converseDiagnostic(
          null,
          'user-1',
          "L'imprimante ne s'allume plus depuis ce matin",
        );

        expect(result.status).toBe('DIAGNOSED');
        if (result.status !== 'DIAGNOSED') return;
        expect(result.diagnosis.degraded).toBe(true);
      });
    });
  });

  // docs/09-architecture-agents-ia.md §3.3 (Agent Technicien). Covers both
  // the degraded-mode path (no API key), which — unlike every other agent in
  // this file — must never fabricate a suggestedScript, and the real-Claude
  // tool-use path (mocked Anthropic SDK) below.
  describe('assistTechnician', () => {
    const context = {
      ticketTitle: 'Imprimante bloquée',
      ticketSummary: 'La file ne se vide plus',
      categoryName: 'Matériel',
      ciHistory: null,
      knowledgeExcerpts: [] as string[],
      knowledgeLowConfidence: false,
    };

    it('falls back to a generic, script-free explanation when no API key is configured', async () => {
      const result = await service.assistTechnician(
        'tech-1',
        'Comment relancer le spouleur ?',
        context,
      );

      expect(result.degraded).toBe(true);
      expect(result.suggestedScript).toBeNull();
      expect(result.explanation.length).toBeGreaterThan(0);
      expect(result.conversationId).toBe('conv-1');
      expect(prisma.aiConversation.create).toHaveBeenCalledWith({
        data: {
          userId: 'tech-1',
          provider: 'CLAUDE',
          model: 'claude-sonnet-5',
        },
      });
    });

    it('falls back to the degraded explanation when the Technician agent is disabled, even with an API key configured', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
      prisma.aiAgent.findUnique.mockResolvedValue({ isActive: false });
      prisma.aiProviderConfig.findUnique.mockResolvedValue({ isActive: true });
      service = await buildService();

      const result = await service.assistTechnician(
        'tech-1',
        'Comment relancer le spouleur ?',
        context,
      );

      expect(result.degraded).toBe(true);
      expect(result.suggestedScript).toBeNull();
      expect(prisma.aiAgent.findUnique).toHaveBeenCalledWith({
        where: { name: 'TECHNICIAN' },
      });
    });

    it('records the degraded response as an AGENT message on the conversation', async () => {
      await service.assistTechnician(
        'tech-1',
        'Comment relancer le spouleur ?',
        context,
      );

      expect(prisma.aiMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: 'conv-1',
            role: 'AGENT',
          }) as unknown,
        }),
      );
    });

    // Real-Claude path, mocked Anthropic SDK (see test/support/anthropic-mock.ts).
    describe('with the AI provider available (mocked)', () => {
      beforeEach(async () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-fake-key-for-test';
        service = await buildService();
      });

      it('returns the AI-generated explanation and suggested script', async () => {
        queueAnthropicResponse(
          toolUseResponse('assist_technician', {
            explanation:
              'Le service de spouleur se bloque après une mise à jour Windows récente.',
            suggestedScript: 'Restart-Service Spooler',
          }),
        );

        const result = await service.assistTechnician(
          'tech-1',
          'Comment relancer le spouleur ?',
          context,
        );

        expect(result.degraded).toBe(false);
        expect(result.suggestedScript).toBe('Restart-Service Spooler');
        expect(result.explanation).toContain('spouleur');
      });

      it('falls back to a degraded, script-free explanation when the AI call errors or times out', async () => {
        queueAnthropicError();

        const result = await service.assistTechnician(
          'tech-1',
          'Comment relancer le spouleur ?',
          context,
        );

        expect(result.degraded).toBe(true);
        expect(result.suggestedScript).toBeNull();
      });
    });
  });
});
