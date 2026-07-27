# 03 — Cahier des charges V2 : AI Help Desk

> Ce document remplace la V1 (produite lors du prototype initial). Il intègre l'architecture cible définie avec l'équipe projet et sert de référence pour les documents techniques suivants (04 à 13).

## 1. Rappel du contexte

AI Help Desk est un outil de support informatique interne assisté par IA, conçu pour un environnement d'entreprise basé sur l'écosystème Microsoft (Entra ID / Active Directory, Intune, Microsoft 365). Il combine diagnostic conversationnel, triage automatique, gestion de tickets en temps réel et actions administratives supervisées (déblocage de compte, réinitialisation de mot de passe) via Microsoft Graph.

Ce document formalise la portée fonctionnelle et technique de la version cible (V2), au-delà du prototype fonctionnel initial (Node/Express/SQLite).

## 2. Stack technologique de référence

| Domaine | Choix retenu |
|---|---|
| Langage | TypeScript (frontend et backend) |
| Frontend | React + Next.js + Tailwind CSS + Shadcn UI |
| Backend | NestJS |
| Base de données | PostgreSQL |
| ORM | Prisma |
| Cache / sessions / rate limiting | Redis |
| File d'attente | BullMQ |
| Authentification | JWT + Refresh Token + SSO Microsoft (OAuth2 / Entra ID) |
| IA générative | Claude (Anthropic), architecture agnostique au fournisseur (extensible OpenAI, Azure OpenAI) |
| RAG / embeddings | PostgreSQL + pgvector |
| Recherche | pgvector (sémantique), Elasticsearch en option future |
| Temps réel | Socket.IO |
| Notifications | Email, Microsoft Teams, Slack/WhatsApp, SMS (futur) |
| Téléassistance | Quick Assist, Microsoft Remote Help, TeamViewer, AnyDesk |
| Écosystème Microsoft | Microsoft Graph API (utilisateurs, Outlook, Teams, OneDrive/SharePoint, licences) |
| Active Directory | Microsoft Graph (priorité) — LDAP en option |
| Gestion des appareils | Microsoft Intune API |
| Journalisation | Pino |
| Monitoring | Grafana + Prometheus |
| Déploiement | Docker + Docker Compose → Kubernetes (futur) |
| Cloud | Railway/Render (démarrage) → Azure (cible) |
| Tests | Jest + Playwright |
| Documentation API | Swagger / OpenAPI |
| Contrôle de version / CI-CD | Git + GitHub + GitHub Actions |

## 3. Modules fonctionnels

### 3.1 Module Authentification & Identité
- Connexion via SSO Microsoft (Entra ID / OAuth2)
- Émission et rotation de JWT + refresh tokens
- Synchronisation des profils utilisateurs via Microsoft Graph (nom, département, rôle)
- Gestion des rôles applicatifs (employé, technicien, superviseur, administrateur)

### 3.2 Module Diagnostic conversationnel
- Interface de chat (React) pour la description du problème
- Appel à la couche IA abstraite (fournisseur configurable, Claude par défaut)
- Enrichissement du diagnostic via RAG (recherche sémantique pgvector sur la base documentaire)
- Repli automatique sur une logique de mots-clés locale si le fournisseur IA est indisponible

### 3.3 Module Gestion des tickets
- Création automatique de ticket si le diagnostic ne résout pas le problème
- Catégorisation et priorisation automatiques (avec correction manuelle possible par un technicien)
- Assignation automatique selon spécialité et charge de travail (file BullMQ pour le traitement asynchrone)
- Mise à jour en temps réel (Socket.IO) des statuts pour l'employé et le technicien
- Historique complet et consultable (filtrage, recherche sémantique)

### 3.4 Module Actions administratives supervisées
- Propositions d'actions Active Directory (déblocage de compte, réinitialisation de mot de passe, gestion de permissions) via Microsoft Graph
- **Validation humaine obligatoire** avant toute exécution — aucune action sensible n'est automatique
- Journalisation complète (qui, quoi, quand, résultat) via Pino

### 3.5 Module Gestion des appareils (Intune)
- Consultation de l'état et de la conformité d'un appareil (lecture automatisable)
- Synchronisation ou déploiement d'application (validation humaine requise)
- Utilisation du statut de conformité comme contexte additionnel dans le diagnostic

### 3.6 Module Notifications
- Envoi de notifications multi-canal (Email via Outlook/Graph, Microsoft Teams, Slack/WhatsApp en option)
- Déclenchement sur événements clés : création, assignation, changement de statut, escalade

### 3.7 Module Téléassistance
- Lancement d'une session Quick Assist ou Microsoft Remote Help directement depuis un ticket
- Alternative TeamViewer/AnyDesk selon les outils disponibles dans l'organisation

### 3.8 Module Administration & Statistiques
- Tableau de bord superviseur : volume de tickets, délais moyens, charge par technicien
- Gestion des techniciens, spécialités, seuils d'escalade
- Export de rapports (CSV/PDF)

## 4. Exigences non fonctionnelles

| Catégorie | Exigence |
|---|---|
| Sécurité | Aucune décision d'autorisation côté client ; principe du moindre privilège sur les scopes Microsoft Graph ; validation humaine pour toute action sensible |
| Disponibilité | Le système doit rester fonctionnel (diagnostic dégradé) même si l'IA externe ou le RAG est indisponible |
| Performance | Temps de réponse du diagnostic initial < 3 secondes en usage normal |
| Traçabilité | Toute action administrative journalisée avec horodatage et identité de l'approbateur |
| Observabilité | Monitoring en continu (Grafana/Prometheus) des ressources et des temps de réponse |
| Portabilité | Déploiement conteneurisé (Docker) permettant une migration de Render/Railway vers Azure sans réécriture |
| Testabilité | Couverture de tests unitaires (Jest) et de bout en bout (Playwright) sur les parcours critiques |

## 5. Rôles applicatifs

| Rôle | Description |
|---|---|
| Employé | Utilisateur final soumettant des demandes |
| Technicien | Traite les tickets assignés, peut proposer des actions AD/Intune (soumises à validation) |
| Superviseur | Valide les actions sensibles proposées par les techniciens, consulte les statistiques d'équipe |
| Administrateur | Gère la configuration système, les intégrations (Graph, IA), les utilisateurs applicatifs |

## 6. Hors périmètre de la V2

- Remplacement complet d'un outil ITSM établi (ex. ServiceNow, Jira Service Management) — AI Help Desk se positionne en complément pour le premier niveau
- Support multi-organisation (multi-tenant) — prévu pour une itération ultérieure si le produit évolue vers un modèle SaaS
- Exécution automatique d'actions administratives sans validation humaine, quelle que soit la confiance du modèle IA

## 7. Références

- Document 01 — Vision produit
- Document 02 — Business Requirements Document (BRD)
- Documents à venir : 04 (User Stories), 05 (Architecture technique détaillée), 06 (Schéma de base de données), 07 (Architecture des agents IA), 09 (Architecture RAG)
