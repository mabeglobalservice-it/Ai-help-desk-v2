// docs/10-architecture-rag.md §6 (génération des embeddings) et §7 (base
// vectorielle). Voyage AI est le fournisseur d'embeddings recommandé par
// Anthropic pour les architectures RAG utilisant Claude, avec un tier
// gratuit exploitable pour un projet de cette taille — un choix naturel
// plutôt que d'exiger un budget dédié dès le départ. Le modèle
// `voyage-multilingual-2` est choisi explicitement pour son support
// multilingue (voir docs.voyageai.com) : le contenu de ce projet est
// très majoritairement en français, un modèle anglophone serait un mauvais
// choix par défaut.
//
// RM-05 (mode dégradé) s'applique ici comme ailleurs dans ce projet : si
// `VOYAGE_API_KEY` est absente, OU si l'appel à l'API échoue pour n'importe
// quelle raison (indisponibilité, quota dépassé, réseau), embed() retombe
// automatiquement sur le vectoriseur local d'origine ("hashing trick" :
// sac-de-mots haché en un vecteur de dimension fixe, normalisé) — gratuit,
// déterministe, toujours disponible, mais sans compréhension sémantique
// réelle. Ce vectoriseur local n'est pas supprimé : il reste le repli.
//
// Les deux vectoriseurs produisent des dimensions différentes (256 pour le
// hashing trick, 1024 pour voyage-multilingual-2) et ne doivent JAMAIS être
// comparés entre eux par similarité cosinus — un score calculé entre les
// deux serait un artefact sans signification, pas juste imprécis. Chaque
// embedding stocké porte donc son fournisseur d'origine
// (DocumentChunk.embeddingProvider, voir prisma/schema.prisma), et
// KnowledgeService.search() ne compare la similarité cosinus qu'entre
// vecteurs du même fournisseur que la requête courante (voir §8) — utile
// notamment si des documents ont été indexés avant l'ajout de
// VOYAGE_API_KEY, ou si la clé est retirée après coup.
//
// embed() garde volontairement la signature simple `(text) => Promise<
// number[]>` — mais un embedding réussi avec Voyage et un repli local sur
// hashing produisent tous les deux un number[], sans indiquer lequel. Pour
// que les appelants qui doivent PERSISTER ou COMPARER un embedding sachent
// avec certitude quel fournisseur a réellement produit le vecteur de cet
// appel précis (et non "la clé est configurée en théorie" — un appel Voyage
// peut échouer et retomber sur hashing sans que l'appelant ne le sache
// autrement), embedWithProvider() renvoie l'information atomiquement avec
// le vecteur. embed() est un raccourci implémenté au-dessus, pour les
// usages qui n'ont pas besoin de cette traçabilité (ex. tests).

import { Logger } from '@nestjs/common';
import { VoyageAIClient } from 'voyageai';

const logger = new Logger('EmbeddingUtil');

// Dimension du vectoriseur hashing trick uniquement — la dimension réelle
// d'un embedding Voyage (1024 pour voyage-multilingual-2) n'est pas figée
// ici, elle vient telle quelle de la réponse de l'API.
export const EMBEDDING_DIMENSIONS = 256;

const VOYAGE_MODEL = 'voyage-multilingual-2';

export type EmbeddingProvider = 'HASHING' | 'VOYAGE';

export interface EmbeddingResult {
  vector: number[];
  provider: EmbeddingProvider;
}

// Construit à chaque appel plutôt qu'une seule fois au chargement du module :
// permet à VOYAGE_API_KEY d'être ajoutée/retirée sans redémarrer le
// processus, et rend le mode dégradé testable simplement en modifiant
// process.env entre deux tests (comme AiService.client), sans jongler avec
// jest.resetModules().
function getVoyageClient(): VoyageAIClient | null {
  return process.env.VOYAGE_API_KEY
    ? new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY })
    : null;
}

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
// Mode dégradé RM-05 — voir le commentaire d'en-tête du fichier.
function hashingEmbed(text: string): number[] {
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

async function voyageEmbed(
  client: VoyageAIClient,
  text: string,
): Promise<number[]> {
  const response = await client.embed({ input: text, model: VOYAGE_MODEL });
  const vector = response.data?.[0]?.embedding;
  if (!vector) {
    throw new Error('Réponse Voyage AI inattendue : aucun embedding reçu');
  }
  return vector;
}

// Point d'entrée réel utilisé par KnowledgeService pour tout ce qui est
// stocké ou comparé : voir le commentaire d'en-tête pour pourquoi ceci
// existe à côté de embed().
export async function embedWithProvider(
  text: string,
): Promise<EmbeddingResult> {
  const client = getVoyageClient();
  if (client) {
    try {
      const vector = await voyageEmbed(client, text);
      return { vector, provider: 'VOYAGE' };
    } catch (error) {
      logger.error(
        "Échec de l'appel à Voyage AI, repli sur le vectoriseur local (hashing trick, RM-05)",
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
  return { vector: hashingEmbed(text), provider: 'HASHING' };
}

export async function embed(text: string): Promise<number[]> {
  return (await embedWithProvider(text)).vector;
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
