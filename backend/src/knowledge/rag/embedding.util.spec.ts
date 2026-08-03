import {
  cosineSimilarity,
  embed,
  lexicalOverlap,
  tokenize,
} from './embedding.util';

describe('embedding.util', () => {
  describe('embed / cosineSimilarity', () => {
    it('gives a higher similarity to a related text than an unrelated one', () => {
      const printer =
        "Imprimante réseau bloquée. Redémarrage du service de spouleur d'impression.";
      const screen =
        'Écran bleu au démarrage. Mise à jour du pilote graphique.';
      const query = 'imprimante bloquée';

      const similarityToPrinter = cosineSimilarity(
        embed(query),
        embed(printer),
      );
      const similarityToScreen = cosineSimilarity(embed(query), embed(screen));

      expect(similarityToPrinter).toBeGreaterThan(similarityToScreen);
    });

    it('gives an identical text a similarity of 1', () => {
      const text = 'Une phrase quelconque pour le test.';
      expect(cosineSimilarity(embed(text), embed(text))).toBeCloseTo(1);
    });

    it('returns a zero vector for empty text', () => {
      expect(embed('')).toEqual(new Array(256).fill(0));
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
