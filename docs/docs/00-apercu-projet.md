# 00 — Aperçu du projet : AI Help Desk

*Document de synthèse rapide — pour présentation en entretien ou premier contact. Voir les documents 01 à 04+ pour le détail complet.*

## En une phrase

**AI Help Desk** n'est pas un logiciel de tickets — c'est **le copilote intelligent des techniciens informatiques**, conçu pour leur faire gagner plusieurs heures par semaine grâce à une architecture multi-agents IA.

## Noms envisagés (à trancher plus tard)

AI Help Desk (provisoire) · NexusDesk AI · IntelliDesk · ITPilot AI · HelpDesk Copilot · SmartSupport AI

## Les 5 piliers

| Pilier | Contenu |
|---|---|
| 1. Support intelligent | Chat IA, diagnostic, création de tickets, priorisation, suggestions |
| 2. Gestion IT (ITSM) | Tickets, SLA, escalade, historique, équipes, files d'attente |
| 3. Gestion des actifs (ITAM) | Ordinateurs, écrans, imprimantes, serveurs, licences, garanties, historique de réparation |
| 4. Automatisation | PowerShell, Intune, Active Directory, Microsoft 365, scripts IA — **toujours avec validation humaine pour les actions sensibles** |
| 5. Intelligence | RAG, recherche documentaire, analyse prédictive, statistiques, génération de documentation |

## Architecture modulaire (aperçu)

```
AI Help Desk
├── Authentication
├── Users (employé / technicien / superviseur / admin — un seul modèle avec rôles)
├── Tickets
├── Diagnostics
├── AI Agents
├── Assets / Inventory
├── Knowledge Base
├── Automation
├── Notifications
├── Reporting
├── Settings
└── Administration
```

## Architecture multi-agents IA — ce qui différencie ce projet

Plutôt qu'un simple chatbot, le système repose sur **6 agents spécialisés** qui collaborent :

| Agent | Rôle | Niveau d'autonomie |
|---|---|---|
| Diagnostic | Pose les bonnes questions, analyse les symptômes, détermine la cause probable | Autonome (information seulement) |
| Help Desk | Dialogue avec l'employé, résout les cas simples, crée les tickets | Autonome (non sensible) |
| Technicien | Explique pannes, commandes, scripts, meilleures pratiques aux techniciens | Autonome (information seulement) |
| Documentation | Recherche dans anciens tickets, procédures, PDF, FAQ (RAG) | Autonome (lecture seule) |
| Automation | Prépare l'exécution de scripts, actions Intune/AD/Graph | **Propose uniquement — validation humaine obligatoire avant toute exécution sensible** |
| Manager | Analyse performances, SLA, statistiques, tendances | Autonome (analyse, pas d'action) |

## Feuille de route par version

| Version | Contenu | Statut |
|---|---|---|
| V1 — MVP | Authentification, tickets, chat IA, tableau technicien, priorité, assignation | Prototype réalisé |
| V2 — ITSM | SLA, notifications, équipes, commentaires, pièces jointes | En conception |
| V3 — Inventaire | Ordinateurs, imprimantes, licences, historique, garanties | Planifié |
| V4 — IA avancée | RAG, mémoire, recherche documentaire, résolution automatique (cas non sensibles) | Planifié |
| V5 — Automatisation | Intune, Microsoft Graph, Active Directory, scripts PowerShell (supervisés) | Planifié |
| V6 — Entreprise | Multi-entreprises, multi-sites, multi-clients, facturation, API publique | Vision long terme (SaaS) |

## Stack technologique

TypeScript · React/Next.js/Tailwind/Shadcn UI · NestJS · PostgreSQL + pgvector · Prisma · Redis · BullMQ · Socket.IO · Claude (IA, agnostique au fournisseur) · Microsoft Graph/Intune · Docker → Azure · Jest/Playwright · Swagger · GitHub Actions

## Ambition du projet

Au-delà du portfolio, ce projet est structuré pour pouvoir devenir :
- Une démonstration technique complète pour recruteurs (code + démarche de conception documentée)
- La base éventuelle d'un produit SaaS commercialisable auprès de PME et grandes entreprises
- Une vitrine cohérente avec l'objectif à moyen terme de Mabe : devenir consultant en IA pour PME, puis bâtir une académie IA

## Méthode de travail

Chaque étape du projet est documentée avant le développement :

`Vision → Analyse des besoins (BRD) → Personas → User Stories → Cas d'utilisation → Cahier des charges → Architecture logicielle → Base de données → API → Maquettes UI/UX → Plan de développement → Développement par module → Tests → Déploiement → Documentation`

*Voir le dossier `docs/` du dépôt pour l'ensemble des documents détaillés.*
