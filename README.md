# AI Help Desk v2

## Structure du projet

```
ai-help-desk-v2/
├── backend/    NestJS + TypeScript + Prisma
├── frontend/   Next.js + TypeScript + Tailwind CSS + Shadcn UI
├── docs/       Documentation du projet
├── docker-compose.yml
├── .gitignore
└── README.md
```

## Prérequis

- Node.js 20+
- npm
- PostgreSQL 16+ (installation locale **ou** Docker — voir ci-dessous)

## 1. Installer les dépendances

```bash
cd backend
npm install
```

```bash
cd frontend
npm install
```

L'installation du backend exécute automatiquement `prisma generate` (hook `postinstall`).

## 2. Démarrer PostgreSQL (et Redis, optionnel)

**Option A — PostgreSQL installé localement**

Assurez-vous qu'une instance tourne sur `localhost:5432` avec un rôle `postgres` / mot de passe `postgres` (ou ajustez `DATABASE_URL` à l'étape suivante en conséquence). Prisma crée la base `ai_help_desk` automatiquement à la première migration — inutile de la créer à la main.

**Option B — Docker Compose**

```bash
docker compose up -d
```

Démarre PostgreSQL sur `localhost:5432` (`postgres` / `postgres` / base `ai_help_desk`) **et** Redis sur `localhost:6379`, définis dans `docker-compose.yml`.

Redis alimente la file BullMQ `notifications-delivery` (envoi asynchrone des emails et webhooks Teams/Slack — voir `backend/src/notifications-delivery/`). Il est **optionnel** : sans Redis (installation locale sans Docker, ou service arrêté), le backend démarre normalement et retombe automatiquement sur l'envoi synchrone des notifications (RM-05) — voir la section [Notifications asynchrones](#notifications-asynchrones-redis--bullmq) plus bas.

## 3. Configurer les variables d'environnement

**Backend** (`backend/.env`, à partir de `backend/.env.example`) :

```bash
cd backend
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL. Par défaut `postgresql://postgres:postgres@localhost:5432/ai_help_desk?schema=public` |
| `JWT_SECRET` | Secret de signature des JWT. Générer une valeur aléatoire : `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Durée de vie du token (ex. `1h`) |
| `FRONTEND_URL` | Origine autorisée en CORS — doit correspondre au port du frontend (`http://localhost:3002` par défaut) |
| `RESEND_API_KEY` | Clé API [Resend](https://resend.com/api-keys), utilisée pour envoyer un email à chaque notification (assignation de ticket, nouveau commentaire) |
| `ANTHROPIC_API_KEY` | Clé API [Anthropic](https://console.anthropic.com/settings/keys), utilisée pour l'analyse IA d'un ticket à la création (`POST /tickets/ai-diagnose`) |
| `VOYAGE_API_KEY` | Clé API [Voyage AI](https://dashboard.voyageai.com/api-keys), utilisée pour les embeddings de la base de connaissances (RAG). Optionnelle : absente, ou en cas d'échec de l'appel, le système retombe automatiquement sur un vectoriseur local gratuit (voir `backend/src/knowledge/rag/embedding.util.ts`) |
| `REDIS_URL` | Connexion Redis pour la file BullMQ `notifications-delivery` (envoi asynchrone des notifications). Par défaut `redis://localhost:6379`. Optionnelle : Redis indisponible → repli automatique sur l'envoi synchrone (voir `backend/src/notifications-delivery/`) |

**Frontend** (`frontend/.env.local`, à partir de `frontend/.env.local.example`) :

```bash
cd frontend
cp .env.local.example .env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL du backend NestJS (`http://localhost:3000` par défaut) |

## 4. Appliquer les migrations et le seed Prisma

```bash
cd backend
npx prisma migrate dev
npm run prisma:seed
```

`prisma migrate dev` crée la base (si nécessaire) et toutes les tables. Le seed (`prisma/seed.ts`) peuple les catégories de ticket (Réseau, Matériel, Logiciel, Accès) et les priorités (Faible, Moyenne, Urgente), indispensables pour créer un ticket depuis le frontend.

## 5. Démarrer les deux serveurs

**Backend** (depuis `backend/`) :

```bash
npm run start:dev
```

**Frontend** (depuis `frontend/`, dans un second terminal) :

```bash
npm run dev
```

## Alternative : tout démarrer avec Docker

docs/07-architecture-logicielle.md §10, docs/14-plan-deploiement-cloud.md §3 : `docker-compose.yml` définit aussi des services `backend` et `frontend` (en plus de `postgres`/`redis`), construits depuis `backend/Dockerfile`/`frontend/Dockerfile`. Utile pour vérifier que l'image de production démarre correctement, ou pour un déploiement simple — pas nécessaire pour le développement au quotidien (`npm run start:dev`/`npm run dev` avec rechargement à chaud restent plus rapides).

Prérequis : `backend/.env` doit exister (voir étape 3 ci-dessus) — `docker compose up` échoue explicitement si ce fichier est absent.

```bash
docker compose up -d --build
```

Démarre les quatre services : PostgreSQL (`5432`), Redis (`6379`), le backend NestJS compilé (`3000`, migrations appliquées automatiquement au démarrage via `prisma migrate deploy`), et le frontend Next.js compilé en mode `standalone` (`3002`). Le frontend est construit avec `NEXT_PUBLIC_API_URL=http://localhost:3000` par défaut (inline dans le bundle au moment du build, pas au démarrage) — surchargez cette variable d'environnement avant de lancer la commande si le backend n'est pas accessible sur `localhost:3000` depuis le navigateur des utilisateurs.

## Tests

Le backend a trois familles de tests, avec des implications très différentes en termes de coût et de rapidité :

| Commande | Ce qu'elle exécute | Appelle une vraie API externe (Anthropic, Voyage AI) ? |
|---|---|---|
| `npm test` (dans `backend/`) | Tests unitaires (`src/**/*.spec.ts`) | **Non** |
| `npm run test:e2e` (dans `backend/`) | Tests end-to-end (`test/*.e2e-spec.ts`), contre un vrai PostgreSQL | **Non** |
| `npm run test:integration:live` (dans `backend/`) | Suite `test/live/*.e2e-spec.ts` — 3 tests de fumée | **Oui, volontairement** |

### Pourquoi cette distinction

`AiService` (module `backend/src/ai/`) appelle l'API Anthropic (Claude) pour cinq agents IA (Diagnostic, Help Desk, Technicien, Documentation, Automatisation), et `embed()`/`embedWithProvider()` (module `backend/src/knowledge/rag/embedding.util.ts`) appellent l'API Voyage AI pour les embeddings de la base de connaissances (RAG). Sans précaution, chaque exécution de test qui passe par l'un de ces appels facturerait un vrai appel API — ce qui devient rapidement coûteux et lent quand ces tests s'exécutent à chaque `npm test`/`npm run test:e2e`, en local comme en CI.

La solution : `backend/test/support/anthropic-mock.ts` et `backend/test/support/voyage-mock.ts` fournissent chacun un mock réutilisable du SDK correspondant (`@anthropic-ai/sdk`, `voyageai`), injecté via `jest.mock(...)` en tête de chaque fichier de test concerné (tous les `*.spec.ts` d'agents IA/RAG, et les `*.e2e-spec.ts` dont un endpoint déclenche un agent IA — `tickets`, `knowledge`, `diagnostics`, `automation`). Le mock Anthropic :

- répond avec une réponse `tool_use` **par défaut, réaliste, propre à chaque outil** (`suggest_ticket_details`, `continue_diagnostic`, `assist_technician`, `propose_knowledge_article`, `suggest_automation_script`, `evaluate_auto_resolution`) — la plupart des tests n'ont donc rien à configurer ;
- permet, via `queueAnthropicResponse(...)`, de simuler un scénario précis pour un seul appel (haute confiance, faible confiance, catégorie détectée, catégorie ambiguë, script proposé, etc.) ;
- permet, via `queueAnthropicError(...)`, de simuler une erreur ou un timeout de l'API, pour vérifier que `AiService` retombe bien sur son mode dégradé (RM-05) plutôt que de planter.

Le mock Voyage suit exactement le même principe (`queueVoyageResponse(...)`, `queueVoyageError(...)`), pour vérifier que `embedWithProvider()` bascule bien vers le vectoriseur local (hashing trick) quand `VOYAGE_API_KEY` est absente ou que l'appel échoue.

Les tests unitaires de `src/ai/ai.service.spec.ts` et `src/knowledge/rag/embedding.util.spec.ts` couvrent ainsi chaque agent/vectoriseur sur son chemin "réel" (mocké) ET son chemin dégradé (sans clé API), sans jamais toucher le réseau.

### La suite `@real-api` (`backend/test/live/`)

Trois tests, un par agent représentatif (Diagnostic, Help Desk, Technicien), appellent volontairement la vraie API Anthropic — sans mock — pour vérifier que les schémas d'outils (tool-use) fonctionnent encore réellement contre le modèle, ce que la suite mockée ne peut pas garantir par construction. (Voyage AI n'a pas son propre test `@real-api` dédié : `embedWithProvider()` est une fonction pure côté schéma de requête/réponse, moins sujette à dérive qu'un tool-use LLM — le mock unitaire suffit.)

Cette suite :
- **n'est jamais exécutée automatiquement** — ni par `npm test`, ni par `npm run test:e2e` (exclue via `testPathIgnorePatterns` dans `backend/test/jest-e2e.json`), ni par le pipeline CI (`.github/workflows/backend-tests.yml`, qui n'invoque jamais `test:integration:live`) ;
- nécessite une vraie clé `ANTHROPIC_API_KEY` configurée dans `backend/.env` ;
- se lance uniquement à la demande :

```bash
cd backend
npm run test:integration:live
```

N'ajoutez pas de nouveaux tests dans `test/live/` sans une bonne raison — la couverture de scénarios détaillée (confiance haute/faible, ambiguïté, erreurs) doit vivre dans `src/ai/ai.service.spec.ts`/`embedding.util.spec.ts` via les mocks, pas ici.

## Notifications asynchrones (Redis + BullMQ)

`NotificationsService.create()` (`backend/src/notifications/notifications.service.ts`) persiste la notification en base et la diffuse en temps réel (WebSocket) de façon **synchrone** — ces opérations sont rapides et in-process. L'envoi de l'email et des webhooks Teams/Slack, en revanche, dépend de services externes potentiellement lents (Resend, Teams, Slack) : plutôt que de faire attendre la requête qui a déclenché la notification (création de ticket, commentaire, changement de statut...), ces deux envois sont déportés vers une file BullMQ dédiée, `notifications-delivery` (`backend/src/notifications-delivery/`).

- **`NotificationsDeliveryService`** ajoute un job `email` et/ou un job `chat` à la file, chacun avec sa propre politique de retry (5 tentatives, backoff exponentiel à partir de 2s) — un canal en échec transitoire ne perd pas la notification.
- **`NotificationsDeliveryProcessor`** consomme ces jobs et appelle réellement `EmailService`/`ChatNotificationsService` — exactement la même logique métier qu'avant l'introduction de la file, seulement déplacée hors du chemin de requête.
- **Repli (RM-05)** : si Redis est indisponible (pas lancé en local, panne, timeout), `NotificationsDeliveryService.enqueueEmail()`/`enqueueChat()` renvoient `false` sans jamais lever, et `NotificationsService` retombe immédiatement sur l'envoi synchrone d'origine (même comportement qu'avant l'introduction de BullMQ), avec un simple avertissement dans les logs. La création de la notification elle-même n'échoue jamais à cause d'un problème Redis ou d'un envoi (synchrone ou en file) qui échoue.

En local, Redis est optionnel : sans lui, tout fonctionne exactement comme avant (envoi synchrone). Pour l'activer :

```bash
docker compose up -d redis
```

ou pointez `REDIS_URL` vers une instance existante (voir la table des variables d'environnement plus haut).

## Ports utilisés

| Service | Port | Note |
|---|---|---|
| Backend (NestJS) | `3000` | Configurable via la variable d'env `PORT` |
| Frontend (Next.js) | `3002` | Fixé dans `frontend/package.json` (`next dev -p 3002`) pour éviter le conflit avec le port 3000 du backend |
| PostgreSQL | `5432` | Local ou via Docker Compose |
| Redis | `6379` | Optionnel, local ou via Docker Compose — voir [Notifications asynchrones](#notifications-asynchrones-redis--bullmq) |
| Documentation Swagger | `http://localhost:3000/api/docs` | Backend uniquement, désactivée si `NODE_ENV=production` |

Si vous changez l'un des ports par défaut, mettez à jour en conséquence `FRONTEND_URL` (backend) et `NEXT_PUBLIC_API_URL` (frontend) pour que le CORS et les appels API continuent de fonctionner.

## Stack technique

- **Backend** : NestJS, TypeScript, Prisma (PostgreSQL)
- **Frontend** : Next.js, TypeScript, Tailwind CSS, Shadcn UI
- **Base de données** : PostgreSQL (locale ou via Docker Compose)
- **File d'attente** : Redis + BullMQ (envoi asynchrone des notifications, optionnel en local — voir [Notifications asynchrones](#notifications-asynchrones-redis--bullmq))
- **Conteneurisation** : Docker (`backend/Dockerfile`, `frontend/Dockerfile`) — voir [Alternative : tout démarrer avec Docker](#alternative--tout-démarrer-avec-docker)
