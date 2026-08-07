import { RedisOptions } from 'ioredis';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

// docs/03-cahier-des-charges-v2.md §"File d'attente" (BullMQ) : Redis est un
// service externe optionnel en développement (RM-05, même esprit que
// ANTHROPIC_API_KEY/VOYAGE_API_KEY) — absent de l'environnement, il retombe
// silencieusement sur `redis://localhost:6379` plutôt que d'exiger une
// configuration explicite pour démarrer en local.
function parseRedisUrl(): RedisOptions {
  const url = new URL(process.env.REDIS_URL ?? DEFAULT_REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    // Sans ça, Node résout "localhost" en IPv4 *et* IPv6 et tente les deux
    // en parallèle (Happy Eyeballs) : une connexion refusée devient alors
    // une AggregateError plutôt qu'une simple Error ECONNREFUSED — une
    // forme que cette version de bullmq/ioredis ne propage pas proprement
    // en interne (observé : un rejet de promesse non intercepté côté
    // BullMQ qui fait planter tout le process quand Redis est indisponible
    // — exactement le scénario que RM-05 doit couvrir). Forcer l'IPv4 fait
    // disparaître l'AggregateError à la source.
    family: 4,
  };
}

// Deux configurations de connexion distinctes, volontairement différentes
// (voir aussi notifications-delivery.processor.ts, qui utilise la seconde) :
//
// - Producteur (cette fonction, utilisée par NotificationsDeliveryService
//   via BullModule.registerQueue) : `enableOfflineQueue: false`. C'est ce
//   qui rend le repli synchrone possible — une commande envoyée alors que
//   la connexion n'est pas prête échoue immédiatement au lieu d'être mise
//   en mémoire tampon par ioredis (qui la rejouerait des heures plus tard
//   quand Redis revient, causant un envoi en double : une fois via le
//   repli synchrone immédiat, une fois via le job BullMQ rejoué).
//
// - Worker (getWorkerRedisConnectionOptions ci-dessous) : configuration
//   par défaut de BullMQ, sans `enableOfflineQueue: false`. Le Worker
//   tourne en tâche de fond (hors du chemin de requête) : imposer un rejet
//   immédiat à sa connexion bloquante (lecture de jobs) n'apporte rien et
//   s'est avéré plus fragile en pratique — le laisser retenter selon la
//   logique par défaut de BullMQ est à la fois plus sûr et plus proche de
//   l'usage prévu par la bibliothèque.
//
// Ni l'une ni l'autre ne redéfinit `retryStrategy` : le comportement par
// défaut de BullMQ (exponentiel, plafonné à 20s, jamais d'abandon) est
// conservé. Conséquence acceptée : un backend qui tourne sans Redis garde
// un minuteur de reconnexion actif en tâche de fond en permanence —
// inoffensif en production (un ping périodique), seulement cosmétique en
// test (Jest peut mettre un instant de plus à quitter).
export function getRedisConnectionOptions(): RedisOptions {
  return {
    ...parseRedisUrl(),
    enableOfflineQueue: false,
  };
}

export function getWorkerRedisConnectionOptions(): RedisOptions {
  return parseRedisUrl();
}
