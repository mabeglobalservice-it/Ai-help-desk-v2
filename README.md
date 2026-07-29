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
