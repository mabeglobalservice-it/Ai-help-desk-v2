# 07 — Architecture logicielle : AI Help Desk

## 1. Vision de l'architecture

L'architecture d'AI Help Desk est guidée par sept objectifs, directement hérités des principes directeurs de la Vision produit (document 01) :

| Objectif | Traduction architecturale |
|---|---|
| Évolutive | Modules indépendants, ajout de nouvelles fonctionnalités sans réécriture des existantes |
| Modulaire | Découpage NestJS par domaine métier (auth, tickets, diagnostics, etc.), chacun avec ses propres responsabilités |
| Sécurisée | RBAC strict, validation humaine obligatoire pour toute action sensible (RM-01, document 06), journalisation systématique |
| Orientée API | Toute fonctionnalité exposée via une API REST/WebSocket documentée, consommable par le frontend ou des clients tiers futurs (V6) |
| IA native | L'IA n'est pas une fonctionnalité ajoutée après coup, mais une couche transversale (orchestrateur + agents spécialisés) |
| Facile à maintenir | Un seul langage (TypeScript) sur toute la stack, conventions NestJS strictes, tests automatisés |
| Compatible Cloud | Conteneurisation dès le départ (Docker), portabilité de Render/Railway vers Azure sans réécriture |

## 2. Architecture générale

```
                              Internet
                                  │
                           Reverse Proxy
                                  │
                          Frontend (Next.js)
                                  │
                        REST API / WebSocket
                                  │
                          Backend (NestJS)
                                  │
      ┌────────────┬─────────────┼─────────────┬──────────────┐
      │            │             │             │              │
  PostgreSQL      Redis       IA Gateway    File Storage   BullMQ (files)
      │            │             │             │              │
      └────────────┴─────────────┴─────────────┴──────────────┘
                                  │
              Microsoft Graph / Intune / Entra ID
```

Le **Reverse Proxy** (ex. Nginx, ou géré directement par Azure Front Door en production) gère le TLS, la répartition de charge future et la protection de base (rate limiting réseau). Le **IA Gateway** est la couche d'abstraction évoquée précédemment — elle isole le reste du système du fournisseur IA réellement utilisé (Claude, OpenAI, Azure OpenAI).

## 3. Architecture Backend

```
src/
├── auth/            # JWT, refresh tokens, SSO Microsoft (OAuth2)
├── users/           # Employé, technicien, superviseur, admin (un modèle, rôles distincts)
├── tickets/         # Cycle de vie des tickets, SLA, escalade
├── diagnostics/     # Orchestration du diagnostic (appel IA Gateway + fallback local)
├── knowledge/       # Base documentaire, ingestion, embeddings (RAG)
├── automation/      # Préparation et exécution supervisée des actions sensibles
├── notifications/   # Email, Teams, Slack/WhatsApp
├── inventory/       # Actifs, licences, garanties (Pilier 3)
├── analytics/       # Statistiques, tendances, rapports (Agent Manager)
├── admin/           # Configuration système, utilisateurs, intégrations
└── common/          # Décorateurs, filtres, pipes, interfaces partagées
```

Chaque module respecte les conventions NestJS (controller / service / module) et communique avec les autres exclusivement via des interfaces définies — jamais par accès direct aux entités internes d'un autre module. Ça permet, par exemple, de remplacer plus tard le module `notifications` sans toucher au module `tickets`.

## 4. Architecture Frontend

```
app/
├── dashboard/       # Vue d'ensemble (employé, technicien, superviseur selon rôle)
├── tickets/         # Création, suivi, détail des tickets
├── inventory/       # Consultation des actifs (Pilier 3)
├── knowledge/       # Recherche documentaire (Pilier 5)
├── automation/      # File d'approbation des actions sensibles
├── settings/        # Préférences utilisateur
components/          # Composants Shadcn UI réutilisables
hooks/                # Logique React réutilisable (ex. useTickets, useSocket)
services/             # Appels API centralisés (typés avec les DTOs du backend)
types/                # Types TypeScript partagés (idéalement générés depuis Swagger/OpenAPI)
```

**Stack** : Next.js, React, TypeScript, Tailwind CSS, Shadcn UI. Le rendu s'appuie sur le App Router de Next.js, avec rendu serveur pour les pages nécessitant une donnée fraîche (ex. tableau technicien) et rendu client pour les interactions temps réel (chat, Socket.IO).

## 5. Architecture IA — architecture multi-agents

```
                        Utilisateur
                             │
                             ▼
                     Orchestrateur IA
                             │
              ┌──────────────┼──────────────┬───────────────┬────────────────┐
              ▼              ▼              ▼               ▼                ▼
      Agent Diagnostic  Agent Documentation  Agent Automation  Agent Inventory  Agent Supervisor
              │              │              │               │                │
              └──────────────┴──────────────┴───────────────┴────────────────┘
                                             │
                                             ▼
                                      Réponse finale
```

**Rôle de l'orchestrateur** : reçoit la requête utilisateur, détermine quel(s) agent(s) solliciter, agrège leurs réponses, et applique les règles métier transversales (notamment RM-01 : toute proposition de l'Agent Automation est marquée comme nécessitant une approbation avant de retourner une réponse finale à l'utilisateur).

**Principe de responsabilité unique** : chaque agent a un périmètre défini et ne déborde pas sur celui d'un autre — l'Agent Diagnostic ne génère pas de scripts, l'Agent Automation ne pose pas de questions de diagnostic. Cette séparation facilite les tests, le remplacement individuel d'un agent, et l'ajout de nouveaux agents (V6 — "agents IA supplémentaires").

## 6. Architecture RAG

```
Question
   │
   ▼
Embedding (vectorisation de la question)
   │
   ▼
Recherche vectorielle (PostgreSQL + pgvector)
   │
   ▼
Documents pertinents (anciens tickets, procédures, FAQ, manuels PDF)
   │
   ▼
Injection dans le contexte du LLM
   │
   ▼
Réponse contextualisée
```

Ce flux garantit que l'IA ne répond jamais uniquement à partir de sa connaissance générale, mais toujours enrichie par la réalité documentaire propre à l'organisation. Le détail complet (pipeline d'ingestion, stratégie de découpage en chunks, fréquence de réindexation) sera couvert au document 09 — Architecture RAG.

## 7. Architecture des données (aperçu)

Entités principales identifiées, qui seront détaillées en schéma relationnel complet au document 08 :

`Utilisateur` (avec sous-types Employé, Technicien via rôle) · `Ticket` · `Actif informatique` · `Intervention` · `Base documentaire` (document + embedding) · `Script` · `Notification` · `Audit` · `SLA`

## 8. Architecture des intégrations

| Intégration | Usage |
|---|---|
| Microsoft Graph | Utilisateurs, Outlook, Teams, OneDrive/SharePoint, licences |
| Microsoft Entra ID | Authentification SSO, gestion d'identité |
| Microsoft Intune | Conformité et gestion des appareils |
| Teams | Notifications, création de tickets |
| Outlook | Notifications par courriel |
| LDAP / Active Directory | Alternative on-premise si non synchronisé avec Entra ID |
| PowerShell | Exécution de scripts d'automatisation (supervisée) |
| SMTP | Envoi de courriels (si Outlook/Graph non disponible) |
| API IA (Claude, OpenAI, Azure OpenAI) | Diagnostic, génération, résumé — via la couche d'abstraction (IA Gateway) |

**Principe directeur** : chaque intégration est encapsulée derrière une interface interne (ex. `NotificationProvider`, `AIProvider`, `IdentityProvider`), afin qu'elle puisse être ajoutée, retirée ou remplacée sans modifier le code des modules qui l'utilisent (inversion de dépendance).

## 9. Architecture de sécurité

| Domaine | Approche |
|---|---|
| Authentification | JWT + refresh token, SSO Microsoft (OAuth2 / Entra ID) |
| Autorisation | RBAC (contrôle d'accès basé sur les rôles) — Employé, Technicien, Superviseur, Administrateur |
| Sessions | Cookies httpOnly pour les tokens, jamais exposés au JavaScript client |
| Chiffrement | TLS en transit, chiffrement au repos pour les données sensibles (via les capacités natives de PostgreSQL/Azure) |
| Variables d'environnement | Aucun secret en dur dans le code ; `.env` exclu du contrôle de version |
| Journalisation | Pino, logs structurés (JSON), incluant systématiquement l'identité de l'acteur |
| Audit | Table dédiée pour les actions sensibles (RM-02), consultable par l'Administrateur |
| Gestion des secrets | Variables d'environnement en développement ; coffre-fort de secrets (ex. Azure Key Vault) en production |
| Validation des entrées | DTOs validés (class-validator) à chaque endpoint NestJS |
| Rate limiting | Sur les endpoints sensibles (authentification, appels IA) pour limiter les abus et contrôler les coûts |
| Gestion des erreurs | Filtres d'exception NestJS centralisés, aucune fuite d'information technique vers le client |

## 10. Architecture de déploiement

**Phase initiale (démonstration/développement)** : Docker + Docker Compose, hébergé sur Render ou Railway.

**Cible (production)** :

```
Utilisateur
    │
    ▼
Azure Front Door
    │
    ▼
Application (conteneurs)
    │
    ▼
PostgreSQL (Azure Database for PostgreSQL)
    │
    ▼
Redis (Azure Cache for Redis)
    │
    ▼
Blob Storage (pièces jointes, documents RAG)
    │
    ▼
Azure OpenAI (fournisseur IA alternatif, selon la couche d'abstraction)
```

Un pipeline **CI/CD via GitHub Actions** automatise les tests (Jest, Playwright) et le déploiement à chaque merge sur `main`, avec un environnement de staging avant la production.

## 11. Architecture des performances

| Stratégie | Application |
|---|---|
| Mise en cache (Redis) | Résultats de recherche fréquents, sessions, données de référence (catégories, techniciens) |
| Files d'attente (BullMQ) | Traitement asynchrone du diagnostic IA, ingestion de documents RAG, envoi de notifications |
| WebSocket (Socket.IO) | Mises à jour en temps réel sans interrogation répétée du serveur (polling) |
| Pagination | Historique des tickets, résultats de recherche documentaire |
| Compression | Réponses HTTP compressées (gzip/brotli) |
| Optimisation des requêtes | Index PostgreSQL sur les colonnes de filtrage fréquent (statut, priorité, technicien_id) |
| Limitation des appels IA | Rate limiting par utilisateur, mise en file BullMQ pour lisser les pics |
| Cache des embeddings | Évite de recalculer l'embedding d'une requête déjà vue récemment |

## 12. Évolutivité

L'architecture est conçue pour permettre, sans réécriture majeure :

- **Multi-entreprises (multi-tenant)** — via un identifiant d'organisation propagé dans chaque entité dès la conception du schéma (document 08)
- **Plusieurs langues** — via l'internationalisation côté frontend (Next.js i18n) et des prompts IA paramétrables
- **Plusieurs modèles d'IA** — déjà couvert par la couche d'abstraction (IA Gateway)
- **Marketplace de connecteurs** — grâce au principe d'inversion de dépendance des intégrations (section 8)
- **API publique** — les mêmes contrôleurs NestJS, avec un niveau d'authentification/autorisation additionnel (clés API, quotas)
- **Application mobile** — consommation de la même API REST/WebSocket, sans backend séparé
- **Agents IA supplémentaires** — ajout au niveau de l'orchestrateur sans modifier les agents existants

## Livrables de ce document

- Schéma d'architecture global (section 2)
- Architecture frontend (section 4) et backend (section 3)
- Architecture IA multi-agents (section 5) et RAG (section 6)
- Architecture de sécurité (section 9) et des intégrations (section 8)
- Architecture cloud / déploiement (section 10)
- Principes de conception transversaux (inversion de dépendance, responsabilité unique, résilience)

Ces éléments alimentent directement les documents suivants : **08 — Schéma de base de données**, **09 — Architecture RAG (détaillée)**, **10 — Documentation API**, et les maquettes UI/UX.
