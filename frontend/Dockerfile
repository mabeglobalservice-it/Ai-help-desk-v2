# docs/07-architecture-logicielle.md §10, docs/14-plan-deploiement-cloud.md §3
# `node:20-slim` (Debian, glibc) plutot qu'alpine : "sharp" (optimisation
# d'images Next.js) est une dependance native dont les binaires precompiles
# ciblent glibc en priorite — evite d'avoir a installer libc6-compat ou une
# chaine de compilation juste pour construire l'image.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* est inline dans le bundle client au moment du build (pas au
# demarrage du conteneur) — doit donc etre fourni en argument de build, pas
# en simple variable d'environnement au lancement. Valeur par defaut alignee
# sur frontend/.env.local.example ; a surcharger via `docker compose build
# --build-arg NEXT_PUBLIC_API_URL=...` (ou la variable d'env du meme nom,
# voir docker-compose.yml) pour un deploiement ou le backend n'est pas sur
# localhost:3000.
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# output: "standalone" (next.config.ts) : ne copie que les fichiers realment
# necessaires en production (trace de dependances), sans le node_modules
# complet ni les outils de build — voir
# https://nextjs.org/docs/app/api-reference/config/next-config-js/output.
# `public/` et `.next/static/` ne sont PAS inclus automatiquement dans le
# dossier standalone (documentation officielle) : copie manuelle requise.
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3002
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
