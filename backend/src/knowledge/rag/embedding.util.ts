// docs/10-architecture-rag.md §6 (génération des embeddings) et §7 (base
// vectorielle). Aucune extension pgvector n'est disponible sur l'instance
// Postgres locale de ce projet, et aucune clé API d'un fournisseur
// d'embeddings (Voyage AI, OpenAI) n'est configurée — plutôt que de bloquer
// la fonctionnalité, ce module fournit un vectoriseur déterministe et
// gratuit ("hashing trick" : sac-de-mots haché en un vecteur de dimension
// fixe, normalisé), dans le même esprit que le mode dégradé RM-05 utilisé
// ailleurs dans ce projet — une vraie recherche par similarité vectorielle,
// mais sans compréhension sémantique réelle. Remplaçable plus tard par un
// vrai fournisseur d'embeddings derrière la même interface (embed()).

export const EMBEDDING_DIMENSIONS = 256;

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Mots très fréquents en français qui n'apportent aucun signal de
// pertinence — les retirer évite qu'ils dominent le vecteur ou le score de
// recouvrement lexical.
const STOPWORDS = new Set([
  'le',
  'la',
  'les',
  'un',
  'une',
  'des',
  'de',
  'du',
  'et',
  'ou',
  'a',
  'au',
  'aux',
  'en',
  'que',
  'qui',
  'ne',
  'pas',
  'pour',
  'par',
  'sur',
  'est',
  'sont',
  'ce',
  'cette',
  'ces',
  'il',
  'elle',
  'avec',
  'dans',
  'plus',
]);

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

// djb2 — simple et suffisant pour répartir des mots dans D casiers, pas un
// hash cryptographique.
function hashToken(token: string): number {
  let hash = 5381;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 33 + token.charCodeAt(i)) >>> 0;
  }
  return hash % EMBEDDING_DIMENSIONS;
}

// Vecteur "sac de mots haché" : chaque mot incrémente le casier de son hash,
// puis le vecteur est normalisé (norme 2 = 1) pour que le produit scalaire
// entre deux vecteurs normalisés soit directement leur similarité cosinus.
export function embed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    vector[hashToken(token)] += 1;
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;

  return vector.map((value) => value / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// Recouvrement lexical, orienté rappel : quelle proportion des mots de la
// requête se retrouve dans le contenu — un chunk long qui contient tous les
// mots d'une requête courte obtient 1.0, même s'il contient beaucoup d'autre
// texte par ailleurs.
export function lexicalOverlap(
  queryTokens: string[],
  contentTokens: string[],
): number {
  if (queryTokens.length === 0) return 0;
  const contentSet = new Set(contentTokens);
  const matches = queryTokens.filter((token) => contentSet.has(token)).length;
  return matches / queryTokens.length;
}
