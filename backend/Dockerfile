# docs/07-architecture-logicielle.md §10, docs/14-plan-deploiement-cloud.md §3
# Build multi-etapes : la premiere etape (deps) n'installe que ce qui est
# necessaire a `npm ci` (package*.json + prisma/schema.prisma, requis par le
# hook postinstall "prisma generate") pour profiter du cache Docker sur les
# dependances meme quand seul le code source change. `node:20-slim` (Debian,
# glibc) plutot qu'une image alpine : bcrypt (dependance native) a des
# binaires precompiles fiables pour glibc, evitant d'avoir a installer une
# chaine de compilation (python3/make/g++) juste pour construire l'image.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# Etape finale : garde node_modules complet (y compris les devDependencies,
# notamment le CLI "prisma" nécessaire à `prisma migrate deploy` au
# demarrage) plutot que de le purger — ce projet vise pour l'instant un
# deploiement a instance unique (docs/14 §4, V1-V3 sur Render/Railway), donc
# le compromis simplicite > taille d'image est deliberement accepte ici.
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/generated ./generated
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

# `prisma migrate deploy` applique les migrations en attente (idempotent,
# sans invite interactive) avant de demarrer le serveur — sûr pour une seule
# instance ; a revisiter si ce projet passe un jour a plusieurs replicas
# (docs/14 §4, V4+/Azure) pour eviter des migrations concurrentes.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
