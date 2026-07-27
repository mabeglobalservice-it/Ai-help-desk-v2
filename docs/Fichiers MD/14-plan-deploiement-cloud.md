# 14 — Plan de déploiement cloud : AI Help Desk

## 1. Objectif

Définir les environnements, l'infrastructure et le processus de déploiement de chaque version du produit, de la démonstration initiale (Render/Railway) jusqu'à la cible de production (Azure), en cohérence avec l'architecture de déploiement définie au document 07 (section 10).

## 2. Environnements

| Environnement | Usage | Infrastructure |
|---|---|---|
| Développement local | Travail quotidien | Docker Compose (NestJS + PostgreSQL + Redis en conteneurs locaux) |
| Staging | Validation avant mise en production, démonstrations | Render/Railway (V1-V3) → Azure (V4+) |
| Production | Usage réel | Azure (cible finale, document 07) |

## 3. Conteneurisation

Chaque service applicatif (backend NestJS, frontend Next.js) possède son propre `Dockerfile`, orchestré localement via `docker-compose.yml` incluant PostgreSQL (avec pgvector), Redis, et les variables d'environnement nécessaires.

```yaml
# Aperçu conceptuel de docker-compose.yml
services:
  backend:
    build: ./backend
    env_file: .env
    depends_on: [postgres, redis]
  frontend:
    build: ./frontend
    env_file: .env
  postgres:
    image: pgvector/pgvector:pg16
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7
```

## 4. Déploiement par version

| Version | Plateforme | Justification |
|---|---|---|
| V1 (MVP) | Render (tier gratuit) | Coût nul, suffisant pour une démonstration, cohérent avec le prototype déjà déployé |
| V2-V3 (ITSM, Inventaire) | Render (tier payant Starter, ~7$/mois) | Le tier gratuit ne supporte pas les disques persistants requis par PostgreSQL en production légère ; le volume de données justifie la stabilité |
| V4-V5 (RAG, Automatisation) | Migration vers Azure | Complexité et sensibilité croissantes (actions AD/Intune) justifient un environnement aligné avec Entra ID/Intune, avec Azure Key Vault pour les secrets |
| V6 (Entreprise) | Azure (production complète) | Autoscaling, haute disponibilité, conformité multi-tenant |

## 5. Infrastructure cible (Azure, V4+)

```
Utilisateur
    │
    ▼
Azure Front Door (TLS, CDN, protection DDoS de base)
    │
    ▼
Azure App Service / Container Apps (backend NestJS, frontend Next.js)
    │
    ├── Azure Database for PostgreSQL Flexible Server (+ pgvector)
    ├── Azure Cache for Redis
    ├── Azure Blob Storage (documents RAG, pièces jointes)
    ├── Azure Key Vault (secrets, clés API)
    └── Azure OpenAI (fournisseur IA alternatif, via la couche d'abstraction)
```

## 6. Gestion des secrets

| Environnement | Méthode |
|---|---|
| Développement local | Fichier `.env`, jamais commité (`.gitignore`) |
| Render/Railway | Variables d'environnement configurées dans le tableau de bord de la plateforme |
| Azure (cible) | Azure Key Vault, injecté dans les conteneurs via Managed Identity — aucun secret en variable d'environnement statique |

## 7. Pipeline CI/CD (GitHub Actions)

```
Push sur une branche ──► Lint + Tests unitaires (Jest)
                                    │
Pull Request vers main ──► Tests E2E (Playwright) + build Docker
                                    │
Merge sur main ──► Déploiement automatique en Staging
                                    │
Validation manuelle ──► Déploiement en Production (approbation requise — cohérent avec la culture de validation humaine du projet)
```

**Étapes du workflow** (`.github/workflows/ci.yml`, aperçu) :
1. Installation des dépendances (`npm ci`)
2. Lint (ESLint) et vérification des types (TypeScript strict)
3. Tests unitaires (Jest) avec couverture minimale requise
4. Build des images Docker
5. Tests E2E (Playwright) contre un environnement éphémère
6. Déploiement conditionnel selon la branche

## 8. Monitoring et observabilité

| Outil | Rôle |
|---|---|
| Grafana + Prometheus | Tableaux de bord CPU, RAM, temps de réponse, taux d'erreur |
| Pino (logs structurés) | Centralisés vers Azure Monitor / Log Analytics en production |
| Alertes | Seuils configurés sur le taux d'erreur 5xx, le temps de réponse des appels IA, et la profondeur des files BullMQ |
| Tableau de bord sécurité | Alerte spécifique sur toute exécution `automation_runs` sans `approval` associée (ne devrait jamais se produire — indicateur d'anomalie critique) |

## 9. Sauvegarde et reprise après sinistre

| Donnée | Politique |
|---|---|
| PostgreSQL (production) | Sauvegardes automatiques quotidiennes (natif Azure Database for PostgreSQL), rétention 30 jours |
| Blob Storage (documents) | Réplication géo-redondante (GRS) pour les documents critiques (procédures, scripts validés) |
| audit_logs | Jamais purgées automatiquement sans politique de rétention explicite validée (document 08, section 7) |

## 10. Stratégie de rollback

- Déploiements via conteneurs versionnés (tag d'image lié au commit Git) — retour à la version précédente en re-déployant l'image antérieure
- Migrations de base de données (Prisma Migrate) toujours accompagnées d'un script de rollback testé avant application en production
- Aucune migration destructive (suppression de colonne/table) déployée sans une fenêtre de dépréciation préalable

## 11. Coûts estimés (ordre de grandeur)

| Phase | Estimation mensuelle |
|---|---|
| V1 (Render gratuit) | 0 $ |
| V2-V3 (Render Starter + Postgres géré) | ~15-25 $ |
| V4-V5 (Azure, ressources modestes) | ~50-150 $ selon le volume d'appels IA et de stockage |
| V6 (Azure, charge de production réelle) | Variable selon le nombre d'organisations clientes — à modéliser séparément dans un plan d'affaires si le projet devient commercial |

## 12. Livrables de ce document

- Environnements et infrastructure par version
- Schéma cible Azure complet (section 5)
- Pipeline CI/CD avec étape d'approbation humaine avant production
- Politique de sauvegarde et de rollback
- Estimation de coûts progressive, alignée sur la feuille de route (documents 01, 13)
