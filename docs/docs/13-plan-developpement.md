# 13 — Plan de développement complet : AI Help Desk

## 1. Objectif

Traduire les 12 documents précédents en un plan d'exécution concret, séquencé par version (documents 01/03), avec livrables, dépendances et critères de sortie pour chaque phase.

## 2. Principes de séquencement

1. **Chaque version livre de la valeur autonome** — on ne commence pas la version suivante avant que la précédente soit fonctionnelle et démontrable
2. **La sécurité n'est jamais une phase à part** — RM-01/RM-02 (validation humaine, audit) sont implémentées dès qu'un module capable d'action sensible existe, pas ajoutées après coup
3. **Le repli local (RM-05) est non négociable dès la V1** — le système ne doit jamais dépendre uniquement d'un service externe pour fonctionner

## 3. Version 1 — MVP (Pilier 1)

**Objectif** : reproduire et solidifier ce qui a déjà été prototypé, sur la nouvelle stack (NestJS/PostgreSQL/Prisma/Next.js).

| Module | Livrable |
|---|---|
| Auth | JWT + refresh token ; SSO Microsoft en option dès que possible, sinon connexion simplifiée en attendant |
| Users | Modèle unique avec rôles (employé, technicien, superviseur, admin) |
| Tickets | Création, catégorisation, priorisation, assignation automatique |
| Diagnostics | Orchestrateur + Agent Diagnostic (Claude), fallback mots-clés local |
| Frontend | Écrans Nouvelle demande, Historique, Tableau technicien (Next.js + Shadcn) |

**Critères de sortie** : parcours complet employé → ticket → technicien → résolution fonctionnel de bout en bout, déployé et accessible via une URL, avec authentification réelle (pas juste nom/rôle).

## 4. Version 2 — ITSM (Pilier 2)

| Module | Livrable |
|---|---|
| Tickets (extension) | Commentaires, pièces jointes |
| SLA | Table `sla_policies`, calcul de `sla_due_at`, escalade automatique |
| Notifications | Email (Graph/Outlook) + Microsoft Teams |
| Organisation | `departments`, `teams` — assignation par équipe spécialisée |
| Temps réel | Socket.IO — mises à jour de statut sans rechargement |

**Critères de sortie** : un ticket qui dépasse son SLA est automatiquement escaladé et notifié ; un employé reçoit une notification Teams/email lors d'un changement de statut.

## 5. Version 3 — Inventaire / CMDB (Pilier 3)

| Module | Livrable |
|---|---|
| Inventory | `configuration_items`, `ci_relationships`, `manufacturers`, `models`, `warranties` |
| Tickets (extension) | Association d'un ticket à un CI |
| Frontend | Fiche CI, vue d'impact (dépendances) |

**Critères de sortie** : un ticket peut être lié à un actif ; l'analyse d'impact (`/inventory/cis/:id/impact`) retourne correctement les CI et utilisateurs dépendants.

## 6. Version 4 — IA avancée / RAG (Pilier 5)

| Module | Livrable |
|---|---|
| Knowledge Base | Pipeline d'ingestion complet (document 10), `documents` + `embeddings` (pgvector) |
| Agent Documentation | Recherche vectorielle, citation de sources, détection de contradictions |
| Diagnostics (extension) | Diagnostic enrichi par le RAG plutôt que par mots-clés seuls comme repli principal |
| Résolution automatique | UC-015, limitée strictement aux actions non sensibles (RM-03) |

**Critères de sortie** : une question technicien retourne des extraits de documents réels avec attribution de source ; le taux de réponses jugées pertinentes (`ai_feedback`) est mesuré en continu.

## 7. Version 5 — Automatisation supervisée (Pilier 4)

| Module | Livrable |
|---|---|
| Automation | `scripts`, `automation_runs`, `approvals` |
| Agent Automation | Préparation d'actions, jamais d'exécution sensible directe |
| Intégrations | Microsoft Graph (AD), Intune, PowerShell |
| Frontend | File d'approbation (document 12, section 4.4) |

**Critères de sortie** : aucune action marquée `is_sensitive = true` ne s'exécute sans une entrée `approvals` au statut `approved` — vérifié par test automatisé, pas seulement par revue de code.

## 8. Version 6 — Entreprise / SaaS

| Module | Livrable |
|---|---|
| Multi-tenant | Isolation par organisation sur toutes les tables pertinentes |
| API publique | Authentification par clé API, quotas, documentation Swagger publique |
| Facturation | Intégration à un fournisseur de paiement (hors périmètre détaillé ici) |

**Critères de sortie** : deux organisations distinctes peuvent utiliser la plateforme sans qu'aucune donnée ne soit visible entre elles.

## 9. Stratégie de tests par version

| Version | Tests prioritaires |
|---|---|
| V1 | Unitaires (Jest) sur la logique de priorité/assignation ; E2E (Playwright) sur le parcours employé→ticket→technicien |
| V2 | Tests d'intégration sur le calcul et l'escalade SLA ; tests des notifications (mock des providers) |
| V3 | Tests sur l'intégrité des `ci_relationships` (pas de cycle, cohérence des dépendances) |
| V4 | Tests de pertinence RAG (jeu de questions/réponses de référence), tests de non-régression sur le filtrage par droits d'accès |
| V5 | **Test de sécurité obligatoire** : toute tentative d'exécution d'un script sensible sans approbation doit échouer systématiquement — test automatisé en CI, pas seulement manuel |
| V6 | Tests d'isolation multi-tenant (aucune fuite de données entre organisations) |

## 10. Dépendances critiques entre versions

```
V1 (MVP) ──► V2 (ITSM) ──► V3 (Inventaire) ──► V4 (IA avancée) ──► V5 (Automatisation) ──► V6 (Entreprise)
   │                                                  │                     │
   └── Auth + Users, requis par toutes les versions   └── RAG requis        └── Approvals + Audit,
                                                          avant résolution      requis avant tout
                                                          automatique (V4)      module Automation
```

## 11. Ressources et estimation (indicative)

*Estimation à titre indicatif pour un développeur solo apprenant la stack en cours de route — à ajuster selon le rythme réel.*

| Version | Effort relatif |
|---|---|
| V1 | Référence (déjà largement prototypé) |
| V2 | Modéré — logique SLA et notifications sont les points les plus complexes |
| V3 | Modéré — CMDB demande une modélisation soignée mais peu de logique complexe |
| V4 | Élevé — pipeline RAG complet est la phase la plus technique du projet |
| V5 | Élevé — la rigueur de sécurité (approbations, audit) demande une attention particulière, pas seulement du code |
| V6 | Élevé — multi-tenant touche transversalement tout le schéma existant |

## 12. Livrables de ce document

- Séquencement complet V1 à V6 avec livrables par module
- Critères de sortie mesurables par version (pas seulement descriptifs)
- Stratégie de tests alignée sur les risques spécifiques de chaque version
- Dépendances critiques explicites, notamment la chaîne Auth → tout, et Approvals/Audit → Automation

Ce plan alimente directement le **document 14 — Plan de déploiement cloud** (quelle version déployer où, et quand migrer vers Azure) et guide l'ordre réel du développement avec Claude Code.
