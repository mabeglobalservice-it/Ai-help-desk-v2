import {
  cosineSimilarity,
  embed,
  embedWithProvider,
  lexicalOverlap,
  tokenize,
} from './embedding.util';
import {
  queueVoyageError,
  queueVoyageResponse,
  resetVoyageMock,
} from '../../../test/support/voyage-mock';

// Voyage AI (rag/embedding.util.ts) : ce fichier n'appelle jamais la vraie
// API — voir test/support/voyage-mock.ts et la section "Tests" du README
// racine.
jest.mock('voyageai', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../../test/support/voyage-mock').voyageSdkMockFactory(),
);

describe('embedding.util', () => {
  const originalApiKey = process.env.VOYAGE_API_KEY;

  beforeEach(() => {
    // docs/06-cas-utilisation.md RM-05 : exerce le repli local (hashing
    // trick) de façon déterministe par défaut, sans dépendre de la
    // présence d'une vraie clé dans l'environnement de test.
    delete process.env.VOYAGE_API_KEY;
    resetVoyageMock();
  });

  afterEach(() => {
    if (originalApiKey) process.env.VOYAGE_API_KEY = originalApiKey;
    else delete process.env.VOYAGE_API_KEY;
  });

  describe('embed / cosineSimilarity (hashing trick, mode dégradé)', () => {
    it('gives a higher similarity to a related text than an unrelated one', async () => {
      const printer =
        "Imprimante réseau bloquée. Redémarrage du service de spouleur d'impression.";
      const screen =
        'Écran bleu au démarrage. Mise à jour du pilote graphique.';
      const query = 'imprimante bloquée';

      const similarityToPrinter = cosineSimilarity(
        await embed(query),
        await embed(printer),
      );
      const similarityToScreen = cosineSimilarity(
        await embed(query),
        await embed(screen),
      );

      expect(similarityToPrinter).toBeGreaterThan(similarityToScreen);
    });

    it('gives an identical text a similarity of 1', async () => {
      const text = 'Une phrase quelconque pour le test.';
      expect(
        cosineSimilarity(await embed(text), await embed(text)),
      ).toBeCloseTo(1);
    });

    it('returns a zero vector for empty text', async () => {
      expect(await embed('')).toEqual(new Array(256).fill(0));
    });
  });

  describe('embedWithProvider', () => {
    it('uses the hashing trick and reports HASHING when VOYAGE_API_KEY is not configured', async () => {
      const result = await embedWithProvider('Imprimante bloquée');

      expect(result.provider).toBe('HASHING');
      expect(result.vector).toHaveLength(256);
    });

    it('calls Voyage AI and reports VOYAGE when a response is returned successfully', async () => {
      process.env.VOYAGE_API_KEY = 'voyage-fake-key-for-test';
      const fakeVector: number[] = new Array(1024).fill(0.01);
      queueVoyageResponse(fakeVector);

      const result = await embedWithProvider('Imprimante bloquée');

      expect(result.provider).toBe('VOYAGE');
      expect(result.vector).toEqual(fakeVector);
    });

    // docs/06-cas-utilisation.md RM-05 : une clé configurée ne garantit pas
    // que l'appel réussisse (quota, réseau, indisponibilité) — le repli doit
    // s'appliquer aussi dans ce cas, pas seulement quand la clé est absente.
    it('falls back to the hashing trick and reports HASHING when the Voyage API call fails', async () => {
      process.env.VOYAGE_API_KEY = 'voyage-fake-key-for-test';
      queueVoyageError();

      const result = await embedWithProvider('Imprimante bloquée');

      expect(result.provider).toBe('HASHING');
      expect(result.vector).toHaveLength(256);
    });
  });

  describe('tokenize', () => {
    it('lowercases, strips accents and drops stopwords', () => {
      expect(tokenize('Le Réseau est bloqué')).toEqual(['reseau', 'bloque']);
    });
  });

  describe('lexicalOverlap', () => {
    it('is 1 when every query token appears in the content', () => {
      expect(
        lexicalOverlap(
          ['imprimante', 'bloquee'],
          ['imprimante', 'bloquee', 'reseau'],
        ),
      ).toBe(1);
    });

    it('is 0 when no query token appears in the content', () => {
      expect(lexicalOverlap(['ecran'], ['imprimante', 'bloquee'])).toBe(0);
    });
  });
});
