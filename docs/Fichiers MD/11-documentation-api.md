# 11 — Documentation API : AI Help Desk

## 1. Objectif et conventions

Ce document liste les endpoints REST et les événements WebSocket exposés par le backend NestJS, organisés par module (document 07). La documentation vivante et interactive est générée automatiquement via **Swagger/OpenAPI** (`@nestjs/swagger`), accessible à `/api/docs` en environnement de développement — ce document sert de référence de conception, pas de substitut à la documentation générée.

### Conventions générales
- Toutes les routes sont préfixées par `/api/v1`
- Authentification : header `Authorization: Bearer <JWT>` sauf routes explicitement publiques
- Format de réponse d'erreur standard :
```json
{ "statusCode": 400, "message": "Description de l'erreur", "error": "Bad Request" }
```
- Pagination standard sur les listes : `?page=1&limit=20`, réponse enveloppée `{ data: [...], total, page, limit }`

## 2. Module Authentication

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/auth/sso/microsoft` | Initie le flux OAuth2 / SSO Microsoft Entra ID | Public |
| GET | `/auth/sso/microsoft/callback` | Callback SSO, émission JWT + refresh token | Public |
| POST | `/auth/refresh` | Émet un nouveau JWT à partir d'un refresh token valide | Refresh token |
| POST | `/auth/logout` | Révoque le refresh token courant | Authentifié |
| GET | `/auth/me` | Retourne l'identité et le rôle de l'utilisateur courant | Authentifié |

## 3. Module Users

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/users` | Liste des utilisateurs (filtrable par rôle, département) | Superviseur, Admin |
| GET | `/users/:id` | Détail d'un utilisateur | Soi-même, Superviseur, Admin |
| PATCH | `/users/:id/role` | Modifie le rôle applicatif d'un utilisateur | Admin |
| PATCH | `/users/:id/specialties` | Associe un technicien à une ou plusieurs spécialités | Admin |
| POST | `/users/sync` | Force une synchronisation manuelle depuis Microsoft Graph | Admin |

## 4. Module Tickets

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/tickets` | Liste des tickets (filtrée selon le rôle — RM-04) | Authentifié |
| GET | `/tickets/:id` | Détail d'un ticket, incluant historique de statut | Employé propriétaire, Technicien assigné, Superviseur |
| POST | `/tickets` | Crée un ticket (catégorisation/priorité/assignation calculées côté serveur) | Employé |
| PATCH | `/tickets/:id/status` | Change le statut d'un ticket | Technicien assigné, Superviseur |
| PATCH | `/tickets/:id/reassign` | Réassigne le ticket à un autre technicien | Technicien, Superviseur |
| POST | `/tickets/:id/comments` | Ajoute un commentaire | Employé propriétaire, Technicien assigné |
| POST | `/tickets/:id/attachments` | Joint un fichier au ticket | Employé propriétaire, Technicien assigné |
| POST | `/tickets/:id/rate` | Évalue la résolution (UC-004) | Employé propriétaire |

## 5. Module Diagnostics (orchestrateur IA)

| Méthode | Route | Description | Accès |
|---|---|---|---|
| POST | `/diagnostics` | Soumet une description de problème, retourne un diagnostic (via orchestrateur → Agent Diagnostic) | Employé, Technicien |
| GET | `/diagnostics/:conversationId` | Récupère l'historique d'une conversation de diagnostic | Propriétaire de la conversation |
| POST | `/diagnostics/:conversationId/feedback` | Enregistre si le diagnostic a été utile (`ai_feedback`) | Technicien |

**WebSocket** : `diagnostic.streaming` — diffuse la réponse de l'agent en temps réel (streaming) pendant sa génération.

## 6. Module AI Agents (administration)

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/ai/agents` | Liste des agents enregistrés et leur statut | Admin |
| PATCH | `/ai/agents/:id/toggle` | Active/désactive un agent | Admin |
| GET | `/ai/providers` | Liste des fournisseurs IA configurés (Claude, OpenAI, Azure) | Admin |
| PATCH | `/ai/providers/active` | Change le fournisseur IA actif (sans redéploiement) | Admin |
| GET | `/ai/conversations/:id/cost` | Coût cumulé d'une conversation (tokens, appels) | Superviseur, Admin |

## 7. Module Knowledge Base (RAG)

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/knowledge/search` | Recherche sémantique (`?q=...&level=...`) — utilisée par l'Agent Documentation | Interne (agent) + Technicien (recherche manuelle) |
| POST | `/knowledge/documents` | Téléverse un nouveau document pour ingestion | Technicien (niveau 5), Admin (niveaux 1-4) |
| GET | `/knowledge/documents/:id` | Détail d'un document indexé | Selon niveau d'accès (document 10, section 10) |
| DELETE | `/knowledge/documents/:id` | Retire un document de l'index | Propriétaire (niveau 5), Admin |
| POST | `/knowledge/articles/propose` | Propose un article généré depuis un ticket résolu | Système (automatique après résolution) |
| PATCH | `/knowledge/articles/:id/approve` | Valide un article proposé avant indexation | Technicien senior, Superviseur |

## 8. Module Automation

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/automation/scripts` | Liste des scripts disponibles | Technicien, Admin |
| POST | `/automation/scripts` | Ajoute un nouveau script (marqué sensible par défaut) | Admin |
| POST | `/automation/runs` | Demande l'exécution d'un script (déclenche `approvals` si sensible) | Technicien |
| GET | `/automation/runs/:id` | Statut d'une exécution | Demandeur, Superviseur, Admin |
| GET | `/automation/approvals/pending` | Liste des approbations en attente | Superviseur, Technicien habilité |
| PATCH | `/automation/approvals/:id` | Approuve ou rejette une action sensible (UC-022) | Superviseur, Technicien habilité |

**Règle appliquée systématiquement** : toute route de ce module vérifie `scripts.is_sensitive` côté serveur avant exécution — jamais uniquement côté client (RM-01, document 06).

## 9. Module Inventory / CMDB

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/inventory/cis` | Liste des Configuration Items (filtrable par type, criticité) | Technicien, Superviseur, Admin |
| GET | `/inventory/cis/:id` | Détail d'un CI, incluant ses dépendances (`ci_relationships`) | Technicien, Superviseur, Admin |
| GET | `/inventory/cis/:id/impact` | Analyse d'impact — quels CI/utilisateurs dépendent de celui-ci | Technicien, Superviseur |
| POST | `/inventory/cis` | Ajoute un nouveau CI | Admin |
| PATCH | `/inventory/cis/:id` | Met à jour un CI (statut, propriétaire, garantie) | Technicien, Admin |

## 10. Module Notifications

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/notifications` | Liste des notifications de l'utilisateur courant | Authentifié |
| PATCH | `/notifications/:id/read` | Marque une notification comme lue | Propriétaire |
| GET | `/notifications/templates` | Liste des modèles de notification | Admin |

**WebSocket** : `notification.new` — diffusion en temps réel d'une nouvelle notification (Socket.IO).

## 11. Module Reporting / Analytics

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/analytics/dashboard` | Statistiques agrégées (volume, délais, charge par technicien) | Superviseur, Admin |
| GET | `/analytics/sla-compliance` | Taux de respect des SLA par période | Superviseur, Admin |
| GET | `/analytics/reports/:id/export` | Export CSV/PDF d'un rapport | Superviseur, Admin |

## 12. Module Administration

| Méthode | Route | Description | Accès |
|---|---|---|---|
| GET | `/admin/settings` | Configuration système courante | Admin |
| PATCH | `/admin/settings` | Modifie la configuration système | Admin |
| GET | `/admin/integrations` | Statut des intégrations (Graph, Intune, IA) | Admin |
| PATCH | `/admin/integrations/:name` | Configure une intégration (scopes, clés) | Admin |
| GET | `/admin/audit-logs` | Recherche dans les journaux d'audit | Admin |

## 13. Événements WebSocket — résumé

| Événement | Émis quand | Reçu par |
|---|---|---|
| `ticket.created` | Un nouveau ticket est créé | Technicien concerné, Superviseur |
| `ticket.statusChanged` | Le statut d'un ticket change | Employé propriétaire, Technicien |
| `ticket.assigned` | Un ticket est assigné/réassigné | Technicien concerné |
| `diagnostic.streaming` | Génération d'une réponse IA en cours | Utilisateur en conversation |
| `notification.new` | Nouvelle notification | Destinataire |
| `approval.requested` | Une action sensible attend une validation | Superviseur, Technicien habilité |

## 14. Sécurité de l'API

- Validation stricte des DTOs à chaque endpoint (`class-validator`)
- Rate limiting appliqué en priorité sur `/auth/*` et `/diagnostics` (coût IA)
- Toutes les routes du module Automation et Administration journalisées dans `audit_logs`, indépendamment de leur succès ou échec
- Documentation Swagger générée automatiquement mais **jamais exposée publiquement en production** sans authentification (évite la reconnaissance de surface d'attaque)

## 15. Livrables de ce document

- Catalogue complet des endpoints par module
- Règles d'accès par rôle pour chaque route
- Événements temps réel (WebSocket) documentés
- Base pour la génération automatique de la documentation Swagger/OpenAPI interactive lors du développement (document 12)
