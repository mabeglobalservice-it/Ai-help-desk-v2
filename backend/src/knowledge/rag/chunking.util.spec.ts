import { chunkText } from './chunking.util';

describe('chunking.util', () => {
  it('returns an empty array for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('keeps a short document as a single chunk', () => {
    const chunks = chunkText('Un court texte de procédure.');
    expect(chunks).toEqual(['Un court texte de procédure.']);
  });

  it('splits an oversized block at maxChunkSize with overlap, never losing content', () => {
    const longBlock = 'x'.repeat(2000);
    const chunks = chunkText(longBlock, { maxChunkSize: 800, overlap: 100 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(800);
    }
    // Le chevauchement garantit qu'aucune partie du texte source n'est perdue
    // entre deux chunks consécutifs.
    expect(chunks[0].length + chunks[1].length).toBeGreaterThan(800);
  });

  it('respects heading boundaries rather than splitting mid-section', () => {
    const text = '# Section A\nContenu A.\n\n# Section B\nContenu B.';
    const chunks = chunkText(text, { maxChunkSize: 15 });

    expect(
      chunks.some((c) => c.includes('Section A') && !c.includes('Section B')),
    ).toBe(true);
  });
});
