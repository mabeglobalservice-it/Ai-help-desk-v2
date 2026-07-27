# 08 — Schéma de base de données : AI Help Desk

## 1. Objectif

Définir les entités, attributs, relations, contraintes, index et règles d'intégrité de la base de données, en intégrant une véritable approche **CMDB (Configuration Management Database)** inspirée d'ITIL — ce qui positionne AI Help Desk comme une plateforme ITSM moderne plutôt qu'un simple gestionnaire de tickets.

## 2. Domaines métier

| Domaine | Tables principales |
|---|---|
| Authentification | `users`, `roles`, `permissions`, `user_sessions`, `refresh_tokens` |
| Organisation | `departments`, `teams`, `locations` |
| Support | `tickets`, `ticket_comments`, `ticket_attachments`, `ticket_status_history`, `ticket_categories`, `priorities`, `sla_policies` |
| Inventaire / CMDB | `configuration_items`, `ci_types`, `ci_relationships`, `assets`, `manufacturers`, `models`, `warranties`, `software`, `installed_software` |
| IA | `ai_conversations`, `ai_messages`, `ai_agents`, `ai_prompts`, `ai_feedback` |
| Base documentaire | `knowledge_articles`, `knowledge_categories`, `documents`, `embeddings` |
| Automatisation | `scripts`, `automations`, `automation_runs`, `approvals` |
| Notifications | `notifications`, `notification_templates`, `notification_logs` |
| Journalisation | `audit_logs`, `activity_logs`, `error_logs` |
| Analyse | `dashboards`, `reports`, `metrics` |
| Configuration | `system_settings`, `ai_provider_configs`, `integration_configs` |

## 3. Diagramme entité-relation (aperçu conceptuel)

```
                              Organisation
                                   │
                     ┌─────────────┼─────────────┐
                     ▼             ▼             ▼
               Department       Team          Location
                     │             │             │
                     └──────┬──────┴─────────────┘
                            ▼
                          User ──────────────┐
                    (role: employee/         │
                     technician/supervisor/   ▼
                     admin)              user_sessions
                            │
             ┌──────────────┼───────────────────────┐
             ▼              ▼                       ▼
          Ticket      ai_conversations          audit_logs
             │              │
   ┌─────────┼─────────┐    ▼
   ▼         ▼         ▼  ai_messages ──► ai_agents
Comments  Attachments  Status History
             │
             ▼
    configuration_items (CI) ◄──── ci_relationships (CI-to-CI)
             │
   ┌─────────┼─────────┐
   ▼         ▼         ▼
 Asset   Warranty   Installed Software
             │
             ▼
        automation_runs ──► approvals (validation humaine, RM-01/RM-02)
             │
             ▼
          scripts
```

## 4. Dictionnaire de données — tables principales

### 4.1 Domaine Authentification

**`users`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| display_name | VARCHAR(255) | NOT NULL |
| role | ENUM(employee, technician, supervisor, admin) | NOT NULL |
| entra_id | VARCHAR(255) | UNIQUE, NULLABLE — identifiant Microsoft Entra ID pour le SSO |
| department_id | UUID | FK → departments.id |
| is_active | BOOLEAN | DEFAULT true |
| created_at | TIMESTAMP | DEFAULT now() |

**`refresh_tokens`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users.id, ON DELETE CASCADE |
| token_hash | VARCHAR(512) | NOT NULL |
| expires_at | TIMESTAMP | NOT NULL |
| revoked | BOOLEAN | DEFAULT false |

### 4.2 Domaine Support

**`tickets`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| reference | VARCHAR(20) | UNIQUE (ex. TCK-2026-2293) |
| employee_id | UUID | FK → users.id |
| technician_id | UUID | FK → users.id, NULLABLE |
| category_id | UUID | FK → ticket_categories.id |
| priority_id | UUID | FK → priorities.id |
| ci_id | UUID | FK → configuration_items.id, NULLABLE — actif concerné |
| title | VARCHAR(255) | NOT NULL |
| summary | TEXT | |
| status | ENUM(new, in_progress, resolved, escalated) | DEFAULT 'new' |
| sla_due_at | TIMESTAMP | calculé selon sla_policies |
| created_at | TIMESTAMP | DEFAULT now() |
| resolved_at | TIMESTAMP | NULLABLE |

**`ticket_status_history`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| ticket_id | UUID | FK → tickets.id, ON DELETE CASCADE |
| from_status | VARCHAR(20) | |
| to_status | VARCHAR(20) | NOT NULL |
| changed_by | UUID | FK → users.id |
| changed_at | TIMESTAMP | DEFAULT now() |

**`sla_policies`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| priority_id | UUID | FK → priorities.id, UNIQUE |
| response_time_minutes | INTEGER | NOT NULL |
| resolution_time_minutes | INTEGER | NOT NULL |

### 4.3 Domaine Inventaire / CMDB

> Extension recommandée : modéliser tous les **Configuration Items (CI)**, pas seulement le matériel physique — postes de travail, serveurs, applications, bases de données, équipements réseau, licences, services métier. Chaque ticket peut être lié à un CI, et chaque CI peut avoir des dépendances envers d'autres CI (`ci_relationships`), ce qui permet de connaître automatiquement l'impact d'un incident.

**`configuration_items`** *(table CMDB centrale)*
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| ci_type_id | UUID | FK → ci_types.id (poste, serveur, application, BD, réseau, licence, service métier) |
| name | VARCHAR(255) | NOT NULL |
| inventory_number | VARCHAR(50) | UNIQUE |
| serial_number | VARCHAR(100) | NULLABLE |
| manufacturer_id | UUID | FK → manufacturers.id, NULLABLE |
| model_id | UUID | FK → models.id, NULLABLE |
| owner_user_id | UUID | FK → users.id, NULLABLE |
| department_id | UUID | FK → departments.id, NULLABLE |
| location_id | UUID | FK → locations.id, NULLABLE |
| criticality | ENUM(low, medium, high, critical) | DEFAULT 'medium' |
| status | ENUM(active, in_repair, retired) | DEFAULT 'active' |
| warranty_id | UUID | FK → warranties.id, NULLABLE |

**`ci_relationships`** *(dépendances entre CI — cœur de la valeur CMDB)*
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| parent_ci_id | UUID | FK → configuration_items.id |
| child_ci_id | UUID | FK → configuration_items.id |
| relationship_type | ENUM(depends_on, hosts, connects_to, runs_on) | NOT NULL |

*Exemple d'usage : un incident sur un serveur (`parent_ci_id`) permet de savoir immédiatement, via `ci_relationships`, quelles applications en dépendent (`child_ci_id`, type `runs_on`) et donc quels employés/services sont potentiellement impactés — la valeur centrale d'une CMDB en ITSM.*

### 4.4 Domaine IA

**`ai_agents`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(50) | UNIQUE (Diagnostic, Documentation, Automation, Supervisor, Inventory, HelpDesk) |
| description | TEXT | |
| is_active | BOOLEAN | DEFAULT true |

**`ai_conversations`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → users.id |
| ticket_id | UUID | FK → tickets.id, NULLABLE |
| provider | VARCHAR(50) | ex. 'claude', 'openai', 'azure-openai' |
| model | VARCHAR(100) | ex. 'claude-sonnet-5' |
| started_at | TIMESTAMP | DEFAULT now() |

**`ai_messages`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| conversation_id | UUID | FK → ai_conversations.id, ON DELETE CASCADE |
| agent_id | UUID | FK → ai_agents.id, NULLABLE |
| role | ENUM(user, agent) | NOT NULL |
| content | TEXT | NOT NULL |
| confidence_score | DECIMAL(4,3) | NULLABLE — utilisé pour RM-03 (seuil ≥ 0.95) |
| response_time_ms | INTEGER | |
| token_cost | DECIMAL(10,6) | NULLABLE |
| created_at | TIMESTAMP | DEFAULT now() |

**`ai_feedback`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| message_id | UUID | FK → ai_messages.id |
| technician_id | UUID | FK → users.id |
| was_helpful | BOOLEAN | NOT NULL |
| comment | TEXT | NULLABLE |

### 4.5 Domaine Base documentaire (RAG)

**`documents`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| title | VARCHAR(255) | NOT NULL |
| source_type | ENUM(pdf, word, excel, image, article) | |
| storage_path | VARCHAR(500) | (Blob Storage / File Storage) |
| uploaded_by | UUID | FK → users.id |
| created_at | TIMESTAMP | DEFAULT now() |

**`embeddings`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| document_id | UUID | FK → documents.id, ON DELETE CASCADE |
| chunk_text | TEXT | NOT NULL |
| chunk_index | INTEGER | |
| vector | VECTOR(1536) | index pgvector (dimension selon le modèle d'embedding choisi) |

### 4.6 Domaine Automatisation

**`scripts`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(255) | NOT NULL |
| language | ENUM(powershell, cmd, bash, python) | |
| content | TEXT | NOT NULL |
| is_sensitive | BOOLEAN | DEFAULT true — détermine si RM-01 s'applique |

**`approvals`** *(table critique — RM-01, RM-02)*
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| automation_run_id | UUID | FK → automation_runs.id |
| requested_by | VARCHAR(50) | ex. 'ai_agent:automation' ou user_id d'un technicien |
| approved_by | UUID | FK → users.id, NULLABLE tant que non traité |
| status | ENUM(pending, approved, rejected) | DEFAULT 'pending' |
| justification | TEXT | |
| decided_at | TIMESTAMP | NULLABLE |

**`automation_runs`**
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| script_id | UUID | FK → scripts.id |
| ticket_id | UUID | FK → tickets.id, NULLABLE |
| ci_id | UUID | FK → configuration_items.id, NULLABLE |
| executed_by | UUID | FK → users.id, NULLABLE (NULL si exécuté automatiquement — uniquement possible si script non sensible) |
| status | ENUM(pending_approval, running, success, failed) | |
| started_at | TIMESTAMP | |
| finished_at | TIMESTAMP | NULLABLE |
| output_log | TEXT | |

### 4.7 Domaine Audit

**`audit_logs`** *(table complète — traçabilité d'entreprise)*
| Champ | Type | Contrainte |
|---|---|---|
| id | UUID | PK |
| actor_id | UUID | FK → users.id, NULLABLE (NULL si acteur système) |
| actor_type | ENUM(user, ai_agent, system) | NOT NULL |
| action | VARCHAR(100) | ex. 'password_reset', 'account_unlock' |
| target_type | VARCHAR(50) | ex. 'user', 'ticket', 'configuration_item' |
| target_id | UUID | |
| ip_address | INET | |
| before_state | JSONB | NULLABLE |
| after_state | JSONB | NULLABLE |
| reason | TEXT | NULLABLE |
| created_at | TIMESTAMP | DEFAULT now() |

## 5. Contraintes d'intégrité

| Type | Application |
|---|---|
| Clés primaires | UUID pour toutes les tables (évite les collisions en environnement distribué, facilite la réplication future) |
| Clés étrangères | Toutes les relations explicitement contraintes (voir dictionnaire ci-dessus) |
| Unicité | `users.email`, `users.entra_id`, `tickets.reference`, `configuration_items.inventory_number` |
| NOT NULL | Champs essentiels au fonctionnement (ex. `tickets.title`, `users.role`) |
| Suppression en cascade | `ON DELETE CASCADE` pour les entités dépendantes (ex. `ai_messages` si `ai_conversations` supprimée) |
| Suppression restreinte | `ON DELETE RESTRICT` pour les référentiels partagés (ex. impossible de supprimer une `priority` utilisée par des tickets actifs) |
| Suppression douce | `ON DELETE SET NULL` pour les relations optionnelles (ex. `tickets.technician_id` si le compte technicien est désactivé) |

## 6. Index recommandés

| Table | Colonnes indexées | Justification |
|---|---|---|
| tickets | status, priority_id, technician_id, category_id | Filtrage fréquent (tableau technicien, historique) |
| users | email, entra_id | Recherche à l'authentification |
| configuration_items | inventory_number, serial_number | Recherche rapide en support |
| embeddings | vector (index HNSW ou IVFFlat via pgvector) | Recherche sémantique performante |
| audit_logs | actor_id, target_type, target_id, created_at | Recherche d'audit par acteur/cible/période |

## 7. Règles d'archivage et de conservation

| Donnée | Politique proposée |
|---|---|
| Tickets résolus | Conservés indéfiniment (historique, statistiques), archivage vers une table froide après 2 ans si le volume l'exige |
| audit_logs | Conservation minimale de 1 an (souvent une exigence réglementaire), non modifiable une fois écrite (append-only) |
| ai_conversations / ai_messages | Conservation 90 jours pour l'amélioration continue, anonymisation ou suppression au-delà sauf besoin d'audit |
| Sessions / refresh_tokens expirés | Purge automatique périodique (job planifié) |

## 8. Choix de modélisation

- **Normalisation** : le schéma respecte la 3ème forme normale (3NF) pour les tables transactionnelles (tickets, users, CI), afin d'éviter la redondance et les anomalies de mise à jour
- **Dénormalisation ciblée** : certains champs calculés (ex. `sla_due_at` sur `tickets`) sont matérialisés plutôt que recalculés à chaque lecture, pour la performance
- **JSONB pour l'audit** : `before_state`/`after_state` en JSONB plutôt qu'en colonnes rigides, car la structure varie selon le type d'entité auditée — un compromis pragmatique entre flexibilité et intégrité relationnelle stricte

## 9. Prisma — extrait du schéma (tables cœur du MVP)

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  displayName  String
  role         Role
  entraId      String?  @unique
  departmentId String?
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())

  ticketsAsEmployee   Ticket[] @relation("EmployeeTickets")
  ticketsAsTechnician Ticket[] @relation("TechnicianTickets")
}

enum Role {
  EMPLOYEE
  TECHNICIAN
  SUPERVISOR
  ADMIN
}

model Ticket {
  id           String    @id @default(uuid())
  reference    String    @unique
  employeeId   String
  employee     User      @relation("EmployeeTickets", fields: [employeeId], references: [id])
  technicianId String?
  technician   User?     @relation("TechnicianTickets", fields: [technicianId], references: [id])
  categoryId   String
  priorityId   String
  ciId         String?
  title        String
  summary      String?
  status       TicketStatus @default(NEW)
  slaDueAt     DateTime?
  createdAt    DateTime  @default(now())
  resolvedAt   DateTime?

  statusHistory TicketStatusHistory[]

  @@index([status, priorityId, technicianId, categoryId])
}

enum TicketStatus {
  NEW
  IN_PROGRESS
  RESOLVED
  ESCALATED
}

model ConfigurationItem {
  id              String   @id @default(uuid())
  ciTypeId        String
  name            String
  inventoryNumber String   @unique
  serialNumber    String?
  criticality     Criticality @default(MEDIUM)
  status          CiStatus    @default(ACTIVE)

  relationshipsAsParent CiRelationship[] @relation("ParentCi")
  relationshipsAsChild  CiRelationship[] @relation("ChildCi")
}

model CiRelationship {
  id               String   @id @default(uuid())
  parentCiId       String
  parent           ConfigurationItem @relation("ParentCi", fields: [parentCiId], references: [id])
  childCiId        String
  child            ConfigurationItem @relation("ChildCi", fields: [childCiId], references: [id])
  relationshipType RelationshipType
}

model AuditLog {
  id         String   @id @default(uuid())
  actorId    String?
  actorType  ActorType
  action     String
  targetType String
  targetId   String
  ipAddress  String?
  beforeState Json?
  afterState  Json?
  reason      String?
  createdAt   DateTime @default(now())

  @@index([actorId, targetType, targetId, createdAt])
}
```

*Le schéma Prisma complet (toutes les tables des 12 domaines) sera généré progressivement, module par module, au document 11 — Plan de développement, plutôt que produit en bloc — pratique standard qui garde le schéma synchronisé avec le développement réel plutôt que théorique.*

## 10. Livrables de ce document

- Dictionnaire de données (section 4)
- Diagramme entité-relation conceptuel (section 3)
- Contraintes d'intégrité (section 5) et index (section 6)
- Règles d'archivage (section 7)
- Justification des choix de modélisation (section 8)
- Extrait Prisma fonctionnel pour le noyau MVP (section 9), base pour le développement réel
