# Audit d'avancement — AI Help Desk v2

*Audit en lecture seule réalisé le 13 octobre 2026 sur `master` (`b230883`) et sur la branche `feat/dashboard-sidebar-theme` (`147578a`, non fusionnée). Aucun fichier de code n'a été modifié.*

> **Mis à jour le 21 octobre 2026** : plusieurs constats ont changé depuis (interface fusionnée, CI au vert, démo en ligne de nouveau accessible). Les sections 0 à 6 décrivent l'état au 13 octobre ; voir la **section 7** pour l'état actuel et une correction.

## 0. Méthode et périmètre

**Sources de référence**
- La liste des fonctionnalités vient de **docs/13 (plan de développement)**. Dans le dépôt, docs/11 est la documentation de l'API. La confusion vient de docs/01 §8-9, qui renvoie encore à un « document 11 — Plan de développement » : c'est l'ancienne numérotation.
- Complétée par docs/00-01 (piliers), 06 (règles RM), 08 (schéma), 09 (agents), 10 (RAG), 11 (API), 12 (UI) et 14 (déploiement).

**Vérifications faites**
- Inventaire automatique des 80 routes des contrôleurs NestJS et des 38 modèles Prisma.
- Recherche des appels réels entre services (qui appelle quoi) et des appels API de chaque page du frontend.
- Exécution des tests unitaires du backend avec couverture.
- Lecture de l'état de la CI via l'API publique GitHub.
- Sondage HTTP des URL Render.

**Règle de classement**
- *Terminé* : branché de bout en bout (route → service → table → interface quand elle est prévue), avec au moins un test.
- *Partiel* : simulé, non branché, ou une partie notable manque.
- *Non commencé* : aucune implémentation, ou seulement une ligne de configuration ou de catalogue.

**Ce qui n'a pas été vérifié**
- Les tests E2E du backend n'ont pas été relancés localement ; ils passent en CI sur `master`.
- `next build` n'a pas été exécuté sur la branche : le serveur de développement utilisait le même dossier `.next`.
- La suite `test/live` (vraie API Anthropic) n'a pas été lancée, car elle est payante.

---

## 1. Avancement par pilier

### Pilier 1 — Support intelligent

| Fonctionnalité | Statut | Preuve | Ce qui manque |
|---|---|---|---|
| Authentification | Partiel | `auth.controller.ts` : `POST /auth/login`, `/refresh`, `/logout`, `GET /me` ; refresh token en cookie httpOnly (`RefreshToken`) ; `@Throttle` sur auth ; `auth.e2e-spec.ts` | **SSO Microsoft Entra ID absent** : routes `/auth/sso/microsoft*` de docs/11 §2 inexistantes, connexion par mot de passe seulement. Le champ `User.entraId` existe mais n'est jamais alimenté. |
| Utilisateurs et rôles | Terminé | `users.controller.ts` (CRUD, `PATCH /:id/specialties`) ; 4 rôles ; `TechnicianSpecialty` ; `users.e2e-spec.ts` | `POST /users/sync` (Graph) absent ; pas de route dédiée `PATCH /users/:id/role` (le rôle passe par `PATCH /users/:id`). |
| Création de ticket, catégorie, priorité | Terminé | `POST /tickets`, `POST /tickets/ai-diagnose` → `AiService.diagnoseTicket` (outil `suggest_ticket_details`) ; repli local par mots-clés ; page `tickets/new` | — |
| Assignation automatique | Terminé | `tickets.service.ts` : recherche `team.findMany` par catégorie, puis technicien par spécialité et charge ; `POST /tickets/:id/suggest-technician` | — |
| Chat IA conversationnel (Agent Help Desk) | Terminé | `AiService.converseDiagnostic` (outil `continue_diagnostic`) ; `POST /diagnostics` ; événement `diagnostic.streaming` ; page `tickets/new` (`startOrContinueDiagnostic`) | Pas d'appel au RAG (voir §3). |
| Évaluation de la résolution (UC-004) | Terminé | `POST /tickets/:id/rate` ; `rateTicket` dans `tickets/[id]` | — |
| Avis sur le diagnostic (`ai_feedback`) | Partiel | `POST /diagnostics/:id/feedback` → `aiFeedback.create` (`diagnostics.service.ts:131`) | **Aucun écran ne l'appelle** : `addDiagnosticFeedback` de `lib/api.ts` n'est utilisée nulle part. La table reste vide en usage réel. |
| Tableau technicien (docs/12 §4.3) | Partiel | `tickets/page.tsx` : liste filtrée par rôle (RM-04), filtres, `SlaBadge` | Les actions en ligne de la maquette (« Prendre en charge », « Résoudre », « Réassigner ») n'existent pas : il faut ouvrir le ticket. Section « Résolus récemment » absente. |

### Pilier 2 — ITSM

| Fonctionnalité | Statut | Preuve | Ce qui manque |
|---|---|---|---|
| Cycle de vie du ticket et historique | Terminé | `PATCH /tickets/:id` ; `TicketStatusHistory` ; note de résolution obligatoire (UC-013) | Les routes `/status` et `/reassign` de docs/11 sont regroupées dans `PATCH /tickets/:id`. Écart de nom seulement. |
| Commentaires et pièces jointes | Terminé (local) | `tickets/:id/comments`, `tickets/:id/attachments` (+ téléchargement) ; `TicketComment`, `TicketAttachment` ; interface dans `tickets/[id]` | **Fichiers sur disque local** (`attachments.constants.ts` : `uploads/tickets`, `diskStorage`) : perdus à chaque redéploiement sur Render. Aucun test unitaire (0 %). |
| Politiques SLA et échéance | Terminé | `SlaPolicy` ; `GET/PATCH /sla-policies` ; `slaDueAt` calculé à la création | — |
| Escalade SLA automatique | Terminé | `sla.service.ts:83` `@Cron(EVERY_5_MINUTES)` → passage en `ESCALATED`, historique de statut, notification ; couverture 98 % | L'escalade automatique n'apparaît pas dans le journal d'audit (seule la modification d'une politique, `SLA_POLICY_UPDATED`, y est tracée). |
| Notifications email | Partiel | `email.service.ts` via **Resend** ; file BullMQ `notifications-delivery` avec repli synchrone | docs/13 prévoit Microsoft Graph/Outlook. Fonctionnel, mais par un autre fournisseur. |
| Notifications Teams / Slack | Terminé (webhook) | `chat-notifications.service.ts` (`TEAMS_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`) | Webhook entrant seulement, pas d'application Teams (Graph). |
| Notifications internes et temps réel | Terminé | `notification.new`, `ticket.created/statusChanged/assigned`, `approval.requested`, `diagnostic.streaming` émis ; `useRealtimeEvent` sur 4 pages | — |
| Départements et équipes | Terminé | `Department`, `Team` ; `teams.controller.ts` ; assignation par équipe | `teams.service.ts` : 0 % de couverture unitaire. |
| Pagination standard `?page&limit` | Non commencé | Aucun DTO ne déclare `page` ou `limit` | Toutes les listes renvoient tout. |

### Pilier 3 — ITAM / CMDB

| Fonctionnalité | Statut | Preuve | Ce qui manque |
|---|---|---|---|
| Équipements (CI), types, fabricants, modèles | Terminé | `ConfigurationItem`, `CiType`, `Manufacturer`, `Model` ; `configuration-items.controller.ts` ; `configuration-items.e2e-spec.ts` | Routes sous `/configuration-items` au lieu de `/inventory/cis` (docs/11 §9). |
| Garanties et licences | Terminé | `Warranty`, `License` ; `GET /configuration-items/licenses` ; pages `admin/licenses`, fiche équipement | — |
| Relations et analyse d'impact | Terminé | `CiRelationship` ; `GET /:id/impact` avec parcours indirect et protection anti-cycle (`configuration-items.service.ts:207`) ; `getCiImpact` sur la fiche | — |
| Lien ticket ↔ équipement | Terminé | `Ticket.ciId` ; sélection dans `tickets/new` ; historique de l'équipement injecté dans l'Agent Technicien | — |
| Historique de réparation | Terminé | Tickets liés au CI, sur la fiche et dans `buildCiHistory` | — |
| Analyse prédictive par modèle | Partiel | `GET /configuration-items/models/reliability` (tendance sur 90 jours, `atRisk`) ; tableau du Tableau de bord | Règle statistique fixe, sans IA ni alerte proactive. |
| Agent Inventory (docs/09 §3.7) | Partiel | Inscrit dans le registre (`prisma/seed.ts`, `INVENTORY`) ; contexte CMDB injecté dans l'Agent Technicien | **Aucun agent dédié** : pas de méthode dans `AiService`, pas de route. |

### Pilier 4 — Automatisation supervisée

| Fonctionnalité | Statut | Preuve | Ce qui manque |
|---|---|---|---|
| Scripts, exécutions, approbations | Terminé | `Script`, `AutomationRun`, `Approval` ; `automation.controller.ts` ; `isSensitive` à `true` par défaut | — |
| File d'approbation (docs/12 §4.4) | Terminé | `automation/approvals/page.tsx` : justification visible, « Approuver » et « Rejeter » côte à côte, avertissement de lecture | — |
| Agent Automation (proposition) | Terminé | `AiService.suggestAutomationForTicket` (outil `suggest_automation_script`) ; `GET /automation/suggest/:ticketId` | — |
| Résolution automatique (UC-015, RM-03) | Terminé (simulée) | `AiService.attemptAutoResolution` (`evaluate_auto_resolution`) ; `automation.service.ts:523` refuse tout script sensible et retombe sur un ticket | L'action n'a aucun effet réel (voir ligne suivante). |
| **Exécution réelle** (PowerShell, AD, Intune, Microsoft 365) | Partiel (simulé) | `automation.service.ts:435-441` `executeRun` : « Exécution simulée… », change seulement le statut et écrit un `outputLog` factice | Aucun exécuteur ni connecteur. Honnêtement signalé dans le code et dans l'interface d'administration. |
| Intégrations Graph / Intune / Entra ID | Non commencé | `admin.service.ts:108-121` : `MICROSOFT_GRAPH` et `INTUNE` marqués « (non implémenté) » | Aucun SDK, aucun OAuth, aucune synchronisation. |

### Pilier 5 — Intelligence / RAG

| Fonctionnalité | Statut | Preuve | Ce qui manque |
|---|---|---|---|
| Ingestion et découpage | Terminé | `knowledge/rag/chunking.util.ts` (91 %) ; `KnowledgeDocument`, `DocumentChunk` ; `POST /knowledge/documents` | Texte brut seulement : pas d'extraction PDF/Word ni de détection de langue (docs/10 §3-4). |
| Embeddings | Terminé | `embedding.util.ts` (98 %) : Voyage AI, repli local par hashing | — |
| Base vectorielle pgvector | Partiel (choix assumé) | `schema.prisma:699-702` : pas d'extension pgvector, similarité calculée dans l'application | Contraire à docs/10 §7 ; ne tiendra pas un gros volume. |
| 5 niveaux et droits d'accès | Terminé | `knowledge.service.ts:198-199`, `canAccessLevel` ; niveau 3 alimenté par `indexResolvedTicket` (`tickets.service.ts:565`), niveau 4 par `indexScript` (`automation.service.ts:129`), niveau 5 personnel (`ownerId`) | Ordre de priorité entre niveaux et reranking (docs/10 §8, §13) non vérifiés comme distincts. |
| Recherche, citation, faible confiance | Terminé | `GET /knowledge/search` ; signalement `lowConfidence` ; page `knowledge` | — |
| Détection de contradictions | Terminé | `AiService.detectContradictions` (`report_contradictions`) | — |
| Génération de documentation | Terminé | `summarizeTicketForKnowledgeArticle` → `proposeArticleFromTicket` → validation humaine (`PATCH /knowledge/articles/:id/approve`, page `knowledge/articles`) | — |
| **Diagnostic enrichi par le RAG** (V4) | Partiel | Seul `tickets.service.assistTechnician` (`:283-300`) appelle `knowledgeService.search` | **Les agents Diagnostic et Help Desk n'interrogent jamais le RAG** : `diagnostics.service.ts` n'importe pas `KnowledgeService`, `converseDiagnostic` ne charge que catégories et priorités. |
| Indicateurs de qualité | Partiel | `GET /knowledge/quality-metrics` (`getQualityMetrics`) | Le taux de pertinence est une approximation (`knowledge.service.ts:62`), faute d'avis réels. Pas de jeu de questions/réponses de référence (docs/13 §9). |
| Agent Manager (docs/09 §3.6) | Non commencé | Inscrit dans le registre (`SUPERVISOR`) ; le Tableau de bord fait des statistiques SQL sans IA (`dashboard.service.ts`) | Aucun agent : pas d'analyse de tendance en langage naturel ni de rapport planifié. |

### V6 — Entreprise / SaaS (hors des 5 piliers, mais dans docs/13)

| Fonctionnalité | Statut | Preuve |
|---|---|---|
| Multi-tenant, API publique par clé, facturation | Non commencé | Aucun modèle `Organization` ; seul `SystemSettings.organizationName` existe. |

---

## 2. Points transversaux demandés

### 2.1 Les sept agents IA

| Agent | Existe dans le code | De bout en bout | Preuve |
|---|---|---|---|
| Diagnostic | Oui | Oui | `diagnoseTicket` ; `POST /tickets/ai-diagnose` ; page `tickets/new` ; test `test/live` |
| Help Desk | Oui | Oui | `converseDiagnostic` ; streaming ; ticket créé en fin de conversation ; test `test/live` |
| Technicien | Oui | Oui | `assistTechnician` + RAG + historique CMDB ; `POST /tickets/:id/assist` ; fiche ticket ; test `test/live` |
| Documentation | Oui | Oui | Recherche, `detectContradictions`, `summarizeTicketForKnowledgeArticle` ; pages `knowledge` |
| Automatisation | Oui | **Partiel** | Propose et passe par l'approbation, mais l'exécution est simulée |
| Gestionnaire (Manager) | Seulement dans le registre | Non | Ligne `SUPERVISOR` dans le seed ; aucune méthode |
| Inventaire | Seulement dans le registre | Non (contexte CMDB réutilisé par le Technicien) | Ligne `INVENTORY` dans le seed ; aucune méthode |

Bilan : **4 agents fonctionnels de bout en bout, 1 partiel, 2 non commencés.**

Points communs :
- Chaque agent vérifie `AiAgent.isActive` (`checkAgentStatus`, `ai.service.ts:437`) et journalise dans `AiConversation` / `AiMessage`.
- Le repli sans clé API est testé (`ai.service.ts` couvert à 96 %).
- **Il n'y a pas d'orchestrateur central** (docs/09 §2) : chaque service métier appelle directement la bonne méthode de `AiService`.

### 2.2 RAG à 5 niveaux et pgvector

Ce qui est réellement indexé :
- niveaux 1, 2 et 4 par téléversement (`createDocument`) ;
- niveau 3 automatiquement à la résolution d'un ticket ;
- niveau 4 aussi à la création d'un script ;
- niveau 5 en personnel, par technicien.

Ce qui est réellement interrogé : la recherche manuelle (`GET /knowledge/search`) et l'Agent Technicien. **pgvector n'est pas utilisé** : les vecteurs sont stockés en base et comparés en mémoire dans l'application.

### 2.3 Microsoft Graph, Intune et Entra ID

**Non commencés.** Les trois intégrations sont absentes du code. L'écran d'administration les affiche comme « non implémenté » (`admin.service.ts:108-121`), et `User.entraId` n'est jamais rempli.

### 2.4 RM-01 et RM-02 : appliquées dans le code

- **Côté serveur, le caractère sensible dépend uniquement de `scripts.is_sensitive`**, jamais de la requête du client (`automation.service.ts:138-172`). Un script sensible crée une approbation au lieu de s'exécuter.
- Le demandeur ne peut pas approuver sa propre demande, et seul un approbateur habilité peut décider (`:430`, `ForbiddenException`).
- La résolution automatique refuse tout script sensible (`:523`).
- **Filet de sécurité** : une tâche planifiée toutes les 5 min (`checkForIntegrityAnomalies`, `:245`) détecte toute exécution sensible sans approbation validée.
- RM-02 : actions `AUTOMATION_RUN_REQUESTED`, `APPROVED`, `REJECTED`, `EXECUTED`, `AUTO_RESOLUTION_*`, avec acteur et horodatage.
- **Test automatisé en CI** : `test/automation.e2e-spec.ts:371` (« creates a pending approval for a sensitive script instead of executing it »), `:402` et `:410`.
- Limite : rien d'irréversible ne s'exécute réellement aujourd'hui, puisque l'exécution est simulée. Le dispositif n'a jamais été éprouvé contre un vrai connecteur.

### 2.5 Journal d'audit (AuditLog)

**Branché, mais incomplet.**
- `AuditLogService.record` est appelé 18 fois dans 6 modules (admin, automation, configuration-items, sla, teams, users), pour 19 types d'actions.
- Il est consultable via `GET /audit-logs` et la page `admin/audit-logs`.

Manques par rapport à docs/11 §14 :
- Les **échecs ne sont pas journalisés** : `record` n'est appelé qu'après un succès, alors que docs/11 §14 demande « indépendamment de leur succès ou échec ».
- Aucune trace pour :
  - l'activation ou la désactivation d'un agent IA et le changement de fournisseur (`ai-agents.service.ts`) ;
  - les documents de connaissance (création, suppression) et la validation des articles ;
  - les connexions.
- `audit-log.service.ts` n'est couvert qu'à 25 % par les tests unitaires.

### 2.6 Interface et alignement sur docs/12

| Élément | `master` | Branche `feat/dashboard-sidebar-theme` |
|---|---|---|
| Navigation | Onglets horizontaux qui débordent | Barre latérale groupée, tiroir sur mobile |
| Couleurs | S'écartent de docs/12 (`#10b981`, `#e0693f`, bleu électrique) | Réalignées sur docs/12, variantes de texte AA, thème sombre |
| Tableau de bord | « Bento » avec tirets | **Aligné** (docs/12 §2-3, §4.5) |
| Les 16 autres pages | Ancienne présentation | **Enveloppe seulement** (barre latérale et en-tête) ; contenu inchangé |

Écarts propres aux pages :
- **Approbations** : conforme à docs/12 §4.4.
- **Connexion** : formulaire email/mot de passe au lieu du bouton SSO de §4.1.
- **Liste des tickets** : sans les actions en ligne de §4.3.
- **Nouvelle demande** : sans le bandeau de statistiques ni la colonne de catégories de §4.2.
- **Base de connaissances et Articles proposés** : des références de spécification (`docs/11 §7`…) apparaissent dans le texte affiché (3 endroits).
- **Contraste** : 10 textes utilisent encore une couleur qui échoue en AA (`text-signal-amber`, `text-signal-moss`, `text-terracotta`).
- **Navigation** : la page Tickets n'est pas dans la barre latérale.

État de la branche :
- **Non fusionnée** : 1 commit, 17 fichiers, environ 2 400 lignes ajoutées.
- **Aucune pull request** sur GitHub, donc **la CI n'a jamais tourné sur cette branche** : les workflows se déclenchent sur `push` vers `master` et sur `pull_request`.
- `tsc` et `eslint` passent en local, mais `next build` et la vérification visuelle restent à faire.

### 2.7 Qualité

**Tests du backend**
- 23 suites unitaires, **292 tests, tous réussis** (exécutés pendant l'audit).
- 12 suites E2E sur un vrai PostgreSQL, plus 3 tests `@real-api` lancés à la main.

**Couverture unitaire mesurée**
- 54 % des lignes, 56 % des branches, 61 % des fonctions.
- Services à forte logique : 86 à 100 % (ai 96 %, automation 91 %, knowledge 91 %, sla 98 %, tickets 94 %, auth 98 %).
- Services sans test unitaire : attachments 0 %, comments 0 %, teams 0 %, catalog 0 % ; dashboard 29 %, audit-log 25 %. Les contrôleurs sont couverts par les E2E.

**Frontend**
- **Aucun test.** La CI ne fait que `npm run lint` et `npm run build`.
- **Pas de Playwright**, alors que docs/13 §9 l'exige pour la V1.

**CI**
- **Le dernier commit de `master` (`b230883`) n'est pas en échec.** Les 3 workflows (Backend tests, Frontend tests, Docker build) sont **au vert** (exécutions du 24 août 2026, API GitHub). Les 12 dernières exécutions sur `master` sont toutes réussies.
- L'échec que vous avez peut-être vu vient sans doute d'une autre source : la branche, qui n'a jamais eu de CI, ou le déploiement Render, en panne (voir §2.8).

**Gestion des erreurs**
- Bonne : mode dégradé RM-05 partout (IA, Voyage, Redis), messages d'erreur en français, validation des données reçues, Helmet.
- Manquant : limitation de débit sur `/diagnostics`, la route qui génère le coût IA (docs/11 §14).

**Variables d'environnement**
- 12 variables lues, toutes documentées dans `backend/.env.example` et le README.
- **Aucune validation au démarrage** (pas de `validationSchema` dans `app.module.ts`) : un `JWT_SECRET` absent n'est détecté qu'au premier usage.

**Secrets**
- Aucun secret commité. `.env` et `.env.local` sont ignorés par git.
- L'historique ne contient que des valeurs factices (`sk-ant-fake-key-for-ci`, `sk-ant-fake-key-for-test`, `sk-ant-your-api-key`).

### 2.8 Déploiement Render

**Ce qui est en place**
- Blueprint `render.yaml` avec 4 ressources gratuites (Postgres, Key Value, backend Docker, frontend Docker).
- Health check `/api/v1/health`, URL croisées câblées automatiquement, migrations au démarrage, Swagger désactivé en production, script `create-admin`.

**État constaté le 13 octobre 2026**
- Le frontend `https://ai-help-desk-frontend.onrender.com` **répond** (HTTP 200, titre « AI Help Desk »). Son bundle appelle `https://ai-help-desk-backend-32r3.onrender.com`.
- Ce **backend ne répond pas** : 3 tentatives de 120 à 150 s, sans aucune réponse. **La démo en ligne est donc inutilisable** : la page de connexion s'affiche, mais aucune connexion n'aboutit.
- Attention : `https://ai-help-desk-backend.onrender.com`, sans suffixe, est **un autre service** (serveur Python, réponse `{"status":"Hey, I am alive :)"}`). Ce n'est pas votre backend.

**Cause la plus probable (non vérifiée, faute d'accès au tableau de bord Render)**
- Le Postgres gratuit, créé vers le 14 août 2026 (commit `0115b8c`), a expiré au bout de 30 jours, puis a été supprimé après les 14 jours de grâce.
- Le backend échoue alors au démarrage (migrations) ou au contrôle de santé.

**Limites du plan gratuit**
- Postgres supprimé après 30 jours, plus 14 jours de grâce.
- Mise en veille après 15 min d'inactivité, environ 1 min de réveil.
- Pas d'accès Shell.
- Key Value sans persistance.
- **Système de fichiers éphémère** : les pièces jointes stockées dans `uploads/` disparaissent à chaque redémarrage.

---

## 3. Pourcentages d'avancement

### 3.1 Par rapport à la vision complète : **≈ 56 %**

**Méthode**
- Chaque bloc est pondéré selon l'effort que docs/13 §11 lui attribue : *référence* ou *modéré* = 2, *élevé* = 3.
- V6 est incluse, puisqu'elle fait partie du plan.
- Le score de chaque bloc est la part des fonctionnalités du §1, pondérée par leur importance : *Terminé* compte 100 %, *Partiel* 30 à 60 % selon ce qui manque, *Non commencé* 0 %.

| Bloc | Poids | Score | Justification courte |
|---|---|---|---|
| Pilier 1 — Support intelligent | 2 | 85 % | SSO, avis sur le diagnostic non branché, actions en ligne du tableau technicien |
| Pilier 2 — ITSM | 2 | 85 % | Email par Resend au lieu de Graph, pagination, pièces jointes éphémères |
| Pilier 3 — ITAM/CMDB | 2 | 85 % | Agent Inventory absent, prédictif simple |
| Pilier 4 — Automatisation | 3 | 45 % | Approbations solides, mais exécution simulée et aucune intégration |
| Pilier 5 — Intelligence/RAG | 3 | 65 % | Pas de pgvector, Diagnostic et Help Desk sans RAG, Agent Manager absent, pertinence approximative |
| V6 — Entreprise/SaaS | 3 | 0 % | Non commencé |

Calcul : (2×85 + 2×85 + 2×85 + 3×45 + 3×65 + 3×0) / 15 = **56 %**. Sur les 5 piliers seuls (poids total 12) : **70 %**.

### 3.2 Vers une version portfolio démontrable : **≈ 63 %**

**Méthode** : les 5 critères que vous avez fixés, chacun noté de 0 à 100 % et pondéré à égalité.

| Critère | Score | Justification |
|---|---|---|
| Interface terminée | 40 % | 1 page sur 17 alignée, branche non fusionnée et non vérifiée visuellement, 10 textes au contraste insuffisant |
| CI au vert | 85 % | `master` au vert sur 3 workflows ; mais aucune CI sur la branche, aucun test frontend, pas d'E2E |
| Journal d'audit branché | 75 % | 19 actions dans 6 modules, page de consultation ; échecs, agents IA, connaissances et connexions non tracés |
| 1 ou 2 agents IA de bout en bout | 100 % | 4 agents fonctionnels (il faudra une clé Anthropic en production) |
| Démo en ligne stable | 15 % | Infrastructure prête, mais backend hors service, aucune donnée de démo, aucun compte de démo |

Calcul : (40 + 85 + 75 + 100 + 15) / 5 = **63 %**. Le critère le plus bloquant est la démo en ligne.

---

## 4. Écarts entre la documentation et le code

1. **SSO Microsoft Entra ID** (docs/11 §2, docs/12 §4.1) : absent ; connexion par mot de passe.
2. **Intégrations Graph, Intune, AD et PowerShell** (docs/00, 01, 09 §3.5, 13 V5) : absentes ; exécution simulée.
3. **pgvector** (docs/00, 10 §7, 14) : non utilisé ; similarité calculée dans l'application. `docker-compose` utilise pourtant l'image `pgvector/pgvector`.
4. **Orchestrateur IA central** (docs/09 §2, §4) : absent ; appels directs à `AiService`, sans agrégation multi-agents.
5. **Agents Manager et Inventory** (docs/09 §3.6-3.7) : inscrits dans le registre, mais non implémentés.
6. **Diagnostic enrichi par le RAG** (docs/13 V4) : seul l'Agent Technicien utilise le RAG.
7. **`ai_feedback` mesuré en continu** (docs/13 V4, docs/10 §12) : la route existe, mais aucun écran ne l'appelle.
8. **Jeu de questions/réponses de référence pour le RAG** (docs/13 §9) : absent.
9. **Email via Graph/Outlook** (docs/13 V2) : remplacé par Resend.
10. **Pagination standard** (docs/11 §1) : absente.
11. **Limitation de débit sur `/diagnostics`** et **audit des échecs** (docs/11 §14) : absents.
12. **Playwright E2E** (docs/00, 13 §9) : absent.
13. **Nommage des routes** : `/configuration-items` au lieu de `/inventory/cis`, `/dashboard/*` au lieu de `/analytics/*`. Mineur.
14. **Ingestion PDF/Word et détection de langue** (docs/10 §3-4) : texte brut seulement.
15. **Incohérences internes à la documentation** :
    - docs/00 parle de 6 agents, docs/09 de 7 ;
    - docs/01 renvoie à un « document 11 — Plan de développement » qui est en réalité le 13 ;
    - la feuille de route de docs/00 (« V2 en conception », « V3 planifié »…) n'est plus à jour ;
    - docs/01 §9 décale la numérotation des versions par rapport à docs/13.

---

## 5. Risques et dette technique

### Critiques
1. **Démo en production hors service** : le backend Render ne répond pas. Cause probable : Postgres gratuit expiré. Tout lien envoyé à un recruteur mène aujourd'hui à une connexion impossible.
2. **Travail d'interface non fusionné et non validé** : la branche n'a ni pull request, ni CI, ni `next build`, ni contrôle visuel. Une erreur de build ne serait pas détectée.

### Élevés
3. **Pas de limitation de débit sur `/diagnostics`** : sur une démo publique avec une vraie clé Anthropic, n'importe qui peut générer des coûts IA sans limite.
4. **Pièces jointes sur disque éphémère** : perte silencieuse de données à chaque redéploiement ou mise en veille Render.
5. **Aucun test frontend ni E2E** : 17 pages et la nouvelle mise en page partagée ne sont protégées par aucun test.
6. **Automatisation entièrement simulée** : à présenter clairement comme une démonstration du *flux d'approbation*, pas comme une automatisation réelle ; sinon, le projet perd en crédibilité devant un recruteur technique.
7. **Pas de validation des variables d'environnement au démarrage** : une configuration incomplète en production se manifeste tard et de façon obscure.

### Moyens
8. **Journal d'audit incomplet** : échecs, agents IA, connaissances et connexions non tracés, contrairement à docs/11 §14.
9. **Similarité vectorielle en mémoire** : coût linéaire avec le nombre de fragments ; acceptable en démo, pas à l'échelle.
10. **Pas de pagination** : les listes (tickets, journal d'audit, inventaire) grossiront sans limite.
11. **Couverture unitaire à 54 %**, avec des trous (attachments, comments, teams, catalog à 0 % ; dashboard 29 %, audit-log 25 %).
12. **Accessibilité** : 10 textes sous le contraste AA, références de spécification visibles dans le texte affiché.

### Faibles
13. Incohérences dans la documentation (§4, point 15).
14. Nommage des routes différent de docs/11.
15. Capture d'écran non suivie à la racine du dépôt ; page Tickets absente de la barre latérale ; Key Value Render sans persistance (déjà compensé par le repli RM-05).

---

## 6. Les 5 tâches prioritaires vers la version portfolio

| # | Tâche | Effort | Pourquoi maintenant |
|---|---|---|---|
| 1 | **Remettre la démo en ligne** : recréer le Postgres Render (ou passer à un Postgres gratuit sans expiration, par exemple Neon ou Supabase), redéployer, vérifier `/api/v1/health`, recréer l'admin. Ajouter une limitation de débit sur `/diagnostics` avant de rendre la démo publique. | Moyen | Critère le plus bas (15 %) et prérequis à tout le reste |
| 2 | **Ajouter un jeu de données de démonstration et des comptes par rôle** : script de seed (tickets sur 60 jours, SLA dépassés, équipements, documents RAG sur les 5 niveaux, approbations en attente), un compte par rôle affiché sur la page de connexion de la démo. | Moyen | Sans données, le Tableau de bord n'affiche que des états vides |
| 3 | **Fusionner et terminer l'interface** : ouvrir la pull request (CI), vérifier à 375, 768 et 1440 px, puis aligner les 16 pages, corriger les 10 textes AA, retirer les références de spécification du texte affiché, ajouter Tickets à la barre latérale, brancher l'avis sur le diagnostic. | Grand | Interface à 40 % ; c'est ce qu'un recruteur voit en premier |
| 4 | **Ajouter un test E2E Playwright** du parcours employé → diagnostic IA → ticket → technicien → résolution, avec l'API IA simulée, lancé en CI. | Moyen | Seul critère de test V1 manquant ; protège la mise en page partagée |
| 5 | **Combler l'audit et le RAG du Diagnostic** : journaliser les échecs, les agents IA, les connaissances et les connexions ; injecter des extraits RAG dans `converseDiagnostic`. Puis un README vitrine avec captures, schéma, scénario de démo et tableau « réel / simulé ». | Moyen | Fait passer l'audit à environ 95 % et rend la promesse V4 vraie pour l'agent le plus visible |

Cible après ces 5 tâches : environ 90 % vers la version portfolio. Le reste relève de la vision (Graph, Intune, SSO, multi-tenant), pas d'une démo.

---

## 7. Mise à jour du 21 octobre 2026

*État de `master` au commit `69ff79c`. Les sections 0 à 6 ne sont pas réécrites : cette section indique ce qui a changé depuis le 13 octobre.*

### 7.1 Ce qui a changé

| Sujet | Le 13 octobre | Le 21 octobre | Preuve |
|---|---|---|---|
| Interface | Branche non fusionnée, sans pull request ni CI | **Fusionnée dans `master`** par la pull request #1 (commit de fusion `245dea0`), branche supprimée | Commits `147578a`, `a8b632a` (corrections du Tableau de bord : initiales, carte « Réponses IA corrigées », titre « SLA dépassé », « Pas de comparaison disponible », cartes KPI alignées) |
| `next build` | Non exécuté | **Réussi** en local et en CI, y compris sur un clone propre avec Node 20 | CI de la pull request #1 et de `master` |
| CI | Au vert sur `master`, jamais lancée sur la branche | **Au vert sur `master` (`69ff79c`)** pour les 3 workflows | API GitHub, exécutions du 21 octobre |
| Démo en ligne | Backend Render sans réponse | **Backend et frontend répondent** (0,4 s) ; le backend lit la base | `GET /api/v1/auth/me` → 401 ; connexion d'un compte inexistant → 401 « Identifiants invalides » ; frontend → 200 |
| Base de production | Postgres Render gratuit, probablement expiré | **Migrée vers Neon** (33 migrations appliquées, selon le propriétaire du projet) | Le backend Render interroge la base sans erreur |
| Données de démonstration | Aucune | **Script `npm run seed:demo`** : 9 comptes `@demo.example` (1 superviseur, 4 techniciens, 4 employés), 4 équipes, 6 actifs, 12 tickets sur 30 jours, 4 articles et 2 documents indexés pour la recherche | Commit `1654c7f` ; testé sur une base locale (second passage sans doublon) |

**Incident de CI résolu en route.** Les jobs « Frontend tests » et « Docker build » échouaient sur la pull request : `next/font/google` télécharge les polices chez Google pendant `next build`, et ce téléchargement échouait en CI (`module-not-found` sur la police Source Serif 4). Les trois polices sont désormais hébergées dans le dépôt (`frontend/src/app/fonts`, `next/font/local`, licence SIL OFL 1.1) : la compilation ne dépend plus du réseau (commit `82622a6`).

### 7.2 Correction d'un constat du 13 octobre

Le rapport affirmait l'**absence de limitation de débit sur `/diagnostics`** (§2.7, §4 point 11, §5 risque 3). C'est inexact : un limiteur global (`ThrottlerGuard`, `app.module.ts:71` et `:92`) applique **100 requêtes par minute et par adresse IP** à toutes les routes, y compris `/diagnostics`. Ce qui manque, c'est une limite **dédiée et plus stricte** sur cette route coûteuse en IA, comme il en existe sur la connexion (5 par minute, `auth.controller.ts:67`) et sur l'automatisation (10 par minute). Le risque est donc réduit, mais pas éliminé.

### 7.3 Ce qui n'a pas changé

- Agents IA, RAG (sans pgvector, sans RAG pour Diagnostic et Help Desk), intégrations Graph / Intune / Entra ID, journal d'audit incomplet, exécution d'automatisation simulée : aucun commit ne les a touchés.
- Les **16 autres pages** n'ont toujours que l'enveloppe (barre latérale et en-tête) ; les 10 textes sous le contraste AA et les références de spécification visibles demeurent.
- **Aucun test frontend ni Playwright.**
- Pièces jointes toujours stockées sur un disque éphémère.

### 7.4 Ce qui n'a pas été vérifié

- La présence du seed, du compte Admin et des données de démonstration sur la base Neon : la vérification s'est limitée à constater que la base répond, sans connexion avec un compte réel.
- Le rendu visuel des pages après la fusion (vérifié par le propriétaire du projet dans son navigateur, pas par l'audit).
- Les limites du plan gratuit de Neon.

### 7.5 Pourcentages mis à jour

**Vision complète : ≈ 56 %, inchangé.** Les commits depuis le 13 octobre portent sur l'interface, la CI et la démo, pas sur les fonctionnalités des piliers.

**Version portfolio : ≈ 63 % → ≈ 74 %**, même méthode qu'au §3.2 :

| Critère | Avant | Après | Justification |
|---|---|---|---|
| Interface terminée | 40 % | 45 % | Tableau de bord fusionné, compilé et corrigé ; mais toujours 1 page sur 17 alignée |
| CI au vert | 85 % | 90 % | CI exercée sur une pull request et au vert sur `master` ; toujours aucun test frontend ni E2E |
| Journal d'audit branché | 75 % | 75 % | Inchangé |
| 1 ou 2 agents IA de bout en bout | 100 % | 100 % | Inchangé |
| Démo en ligne stable | 15 % | 60 % | Backend et frontend de nouveau en ligne, base Neon sans expiration à 30 jours, script de données de démonstration ; présence des données en production non vérifiée, pas de limite dédiée sur `/diagnostics` |

Calcul : (45 + 90 + 75 + 100 + 60) / 5 = **74 %**.

### 7.6 Risques et tâches prioritaires

**Risques du §5**
- Risque critique 1 (démo hors service) : **levé**, sous réserve que les données soient bien présentes sur Neon.
- Risque critique 2 (interface non fusionnée et non validée) : **levé**.
- Risque élevé 3 (débit sur `/diagnostics`) : **réduit** (voir §7.2) ; il devient la priorité de sécurité maintenant que la démo est publique.
- Les autres risques sont inchangés.

**Avancement des 5 tâches du §6**

| # | Tâche | État |
|---|---|---|
| 1 | Remettre la démo en ligne | **Largement fait** : base sur Neon, services en ligne. Reste une limite dédiée sur `/diagnostics` et la vérification des données en production. |
| 2 | Données et comptes de démonstration | **Script fait** (`seed:demo`). Reste à confirmer son exécution sur Neon et à afficher les comptes par rôle sur la page de connexion de la démo. |
| 3 | Fusionner et terminer l'interface | **Fusion faite.** Restent les 16 pages, les 10 textes AA, les références de spécification, l'entrée Tickets dans la barre latérale et l'avis sur le diagnostic. |
| 4 | Test E2E Playwright en CI | Non commencé. |
| 5 | Journal d'audit, RAG du Diagnostic, README vitrine | Non commencé. |

Nouvel ordre conseillé : limite dédiée sur `/diagnostics` et vérification des données de démo (petit effort), puis les tâches 3, 4 et 5.
