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
- Docker (pour PostgreSQL)

## Démarrage

### 1. Base de données

```bash
docker compose up -d
```

Démarre PostgreSQL sur `localhost:5432` (utilisateur/mot de passe/base : voir `docker-compose.yml`).

### 2. Backend (NestJS + Prisma)

```bash
cd backend
npm install
cp .env.example .env   # ajuster DATABASE_URL si besoin
npx prisma migrate dev
npm run start:dev
```

### 3. Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

## Stack technique

- **Backend** : NestJS, TypeScript, Prisma (PostgreSQL)
- **Frontend** : Next.js, TypeScript, Tailwind CSS, Shadcn UI
- **Base de données** : PostgreSQL (via Docker Compose)
