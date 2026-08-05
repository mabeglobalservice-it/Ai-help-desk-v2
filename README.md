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

## 2. Démarrer PostgreSQL

**Option A — PostgreSQL installé localement**

Assurez-vous qu'une instance tourne sur `localhost:5432` avec un rôle `postgres` / mot de passe `postgres` (ou ajustez `DATABASE_URL` à l'étape suivante en conséquence). Prisma crée la base `ai_help_desk` automatiquement à la première migration — inutile de la créer à la main.

**Option B — Docker Compose**

```bash
docker compose up -d
```

Démarre PostgreSQL sur `localhost:5432` avec les mêmes identifiants (`postgres` / `postgres` / base `ai_help_desk`), définis dans `docker-compose.yml`.

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

## Tests

Le backend a trois familles de tests, avec des implications très différentes en termes de coût et de rapidité :

| Commande | Ce qu'elle exécute | Appelle la vraie API Anthropic ? |
|---|---|---|
| `npm test` (dans `backend/`) | Tests unitaires (`src/**/*.spec.ts`) | **Non** |
| `npm run test:e2e` (dans `backend/`) | Tests end-to-end (`test/*.e2e-spec.ts`), contre un vrai PostgreSQL | **Non** |
| `npm run test:integration:live` (dans `backend/`) | Suite `test/live/*.e2e-spec.ts` — 3 tests de fumée | **Oui, volontairement** |

### Pourquoi cette distinction

`AiService` (module `backend/src/ai/`) appelle l'API Anthropic (Claude) pour cinq agents IA (Diagnostic, Help Desk, Technicien, Documentation, Automatisation). Sans précaution, chaque exécution de test qui passe par un de ces agents facturerait un vrai appel API — ce qui devient rapidement coûteux et lent quand ces tests s'exécutent à chaque `npm test`/`npm run test:e2e`, en local comme en CI.

La solution : `backend/test/support/anthropic-mock.ts` fournit un mock réutilisable du SDK `@anthropic-ai/sdk`, injecté via `jest.mock('@anthropic-ai/sdk', ...)` en tête de chaque fichier de test concerné (tous les `*.spec.ts` d'agents IA, et les `*.e2e-spec.ts` dont un endpoint déclenche un agent IA — `tickets`, `knowledge`, `diagnostics`, `automation`). Ce mock :

- répond avec une réponse `tool_use` **par défaut, réaliste, propre à chaque outil** (`suggest_ticket_details`, `continue_diagnostic`, `assist_technician`, `propose_knowledge_article`, `suggest_automation_script`, `evaluate_auto_resolution`) — la plupart des tests n'ont donc rien à configurer ;
- permet, via `queueAnthropicResponse(...)`, de simuler un scénario précis pour un seul appel (haute confiance, faible confiance, catégorie détectée, catégorie ambiguë, script proposé, etc.) ;
- permet, via `queueAnthropicError(...)`, de simuler une erreur ou un timeout de l'API, pour vérifier que `AiService` retombe bien sur son mode dégradé (RM-05) plutôt que de planter.

Les tests unitaires de `src/ai/ai.service.spec.ts` couvrent ainsi chaque agent sur son chemin "réel-Claude" (mocké) ET son chemin dégradé (sans clé API), sans jamais toucher le réseau.

### La suite `@real-api` (`backend/test/live/`)

Trois tests, un par agent représentatif (Diagnostic, Help Desk, Technicien), appellent volontairement la vraie API Anthropic — sans mock — pour vérifier que les schémas d'outils (tool-use) fonctionnent encore réellement contre le modèle, ce que la suite mockée ne peut pas garantir par construction.

Cette suite :
- **n'est jamais exécutée automatiquement** — ni par `npm test`, ni par `npm run test:e2e` (exclue via `testPathIgnorePatterns` dans `backend/test/jest-e2e.json`), ni par le pipeline CI (`.github/workflows/backend-tests.yml`, qui n'invoque jamais `test:integration:live`) ;
- nécessite une vraie clé `ANTHROPIC_API_KEY` configurée dans `backend/.env` ;
- se lance uniquement à la demande :

```bash
cd backend
npm run test:integration:live
```

N'ajoutez pas de nouveaux tests dans `test/live/` sans une bonne raison — la couverture de scénarios détaillée (confiance haute/faible, ambiguïté, erreurs) doit vivre dans `src/ai/ai.service.spec.ts` via le mock, pas ici.

## Ports utilisés

| Service | Port | Note |
|---|---|---|
| Backend (NestJS) | `3000` | Configurable via la variable d'env `PORT` |
| Frontend (Next.js) | `3002` | Fixé dans `frontend/package.json` (`next dev -p 3002`) pour éviter le conflit avec le port 3000 du backend |
| PostgreSQL | `5432` | Local ou via Docker Compose |
| Documentation Swagger | `http://localhost:3000/api/docs` | Backend uniquement, désactivée si `NODE_ENV=production` |

Si vous changez l'un des ports par défaut, mettez à jour en conséquence `FRONTEND_URL` (backend) et `NEXT_PUBLIC_API_URL` (frontend) pour que le CORS et les appels API continuent de fonctionner.

## Stack technique

- **Backend** : NestJS, TypeScript, Prisma (PostgreSQL)
- **Frontend** : Next.js, TypeScript, Tailwind CSS, Shadcn UI
- **Base de données** : PostgreSQL (locale ou via Docker Compose)
