import { Test, TestingModule } from '@nestjs/testing';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AiService', () => {
  let service: AiService;
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(async () => {
    // docs/06-cas-utilisation.md RM-05: exercises the degraded (no API key)
    // fallback path deterministically, without depending on network access
    // or real credentials being present in the test environment.
    delete process.env.ANTHROPIC_API_KEY;

    const module: TestingModule = await Test.createTestingModule({
      providers: [AiService, { provide: PrismaService, useValue: {} }],
    }).compile();

    service = module.get(AiService);
  });

  afterEach(() => {
    if (originalApiKey) process.env.ANTHROPIC_API_KEY = originalApiKey;
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
  });
});
