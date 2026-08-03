// docs/10-architecture-rag.md §5 (stratégie de chunking) : le découpage
// respecte la structure logique du document (titres, sections, étapes
// numérotées) plutôt qu'une longueur fixe arbitraire, avec un léger
// chevauchement entre blocs consécutifs quand un bloc doit malgré tout être
// tronqué (préserve le contexte aux frontières).

export interface ChunkOptions {
  maxChunkSize?: number;
  overlap?: number;
}

const DEFAULT_MAX_CHUNK_SIZE = 800;
const DEFAULT_OVERLAP = 100;

const BLOCK_BOUNDARY = /^(#{1,6}\s|\d+[.)]\s)/;

// Découpe en blocs logiques : paragraphes séparés par une ligne vide, puis
// re-découpés dès qu'une ligne démarre un titre markdown ou une étape
// numérotée, pour qu'une frontière de bloc tombe toujours sur une frontière
// structurelle du document source.
function splitIntoBlocks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const blocks: string[] = [];

  for (const paragraph of paragraphs) {
    const lines = paragraph.split('\n');
    let current: string[] = [];
    for (const line of lines) {
      if (BLOCK_BOUNDARY.test(line.trim()) && current.length > 0) {
        blocks.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) blocks.push(current.join('\n'));
  }

  return blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChunkSize = options.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  // Le chevauchement doit rester strictement inférieur à maxChunkSize, sinon
  // la découpe à longueur fixe ci-dessous ne progresse jamais (boucle
  // infinie) — un appelant qui demande un chunk minuscule avec le
  // chevauchement par défaut ne doit jamais planter.
  const overlap = Math.min(
    options.overlap ?? DEFAULT_OVERLAP,
    maxChunkSize - 1,
  );
  const blocks = splitIntoBlocks(text);
  if (blocks.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
  };

  for (const block of blocks) {
    if (block.length > maxChunkSize) {
      // Bloc trop long pour tenir dans un seul chunk (ex. procédure sans
      // sous-titres) : découpe à longueur fixe avec chevauchement, en
      // dernier recours seulement.
      flush();
      let start = 0;
      while (start < block.length) {
        const end = Math.min(start + maxChunkSize, block.length);
        chunks.push(block.slice(start, end).trim());
        if (end >= block.length) break;
        start = end - overlap;
      }
      continue;
    }

    if (current.length + block.length + 2 > maxChunkSize) {
      flush();
      current = block;
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  }
  flush();

  return chunks.filter((chunk) => chunk.length > 0);
}
