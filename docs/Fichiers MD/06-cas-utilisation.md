# 06 — Use Case Specification : AI Help Desk

## 1. Introduction

### 1.1 Objectif du document
Décrire, de façon détaillée et non ambiguë, tous les scénarios fonctionnels de l'application — le déroulement normal, les variantes et les cas d'erreur — afin de servir de référence commune entre la conception, le développement et les tests.

### 1.2 Portée
Ce document couvre les cas d'utilisation du MVP (V1) ainsi que les cas d'utilisation majeurs des versions ultérieures (ITSM, Automatisation supervisée), identifiés comme prioritaires pour la conception de l'architecture (documents 07-08).

### 1.3 Acteurs
Cinq acteurs interagissent avec le système : **Employé**, **Technicien**, **Superviseur**, **Administrateur**, et **Agent IA** (acteur non humain, mais dont le comportement doit être spécifié au même titre qu'un acteur humain, puisqu'il initie des actions dans le système).

### 1.4 Règles métier transversales

| ID | Règle |
|---|---|
| RM-01 | Aucune action à impact de sécurité (déblocage de compte, réinitialisation de mot de passe, suppression de ressource, exécution de script système) ne peut être exécutée par l'Agent IA sans validation explicite d'un Technicien ou Superviseur |
| RM-02 | Toute action sensible, proposée ou exécutée, est journalisée avec l'identité de l'approbateur, l'horodatage et le résultat |
| RM-03 | La résolution automatique par l'IA (UC-015) est limitée aux actions **non sensibles** (ex. redémarrage d'un service, vidage de cache, correction de configuration réversible) — jamais à une action touchant l'identité, les permissions ou l'intégrité d'un système |
| RM-04 | Un technicien ne peut modifier que les tickets qui lui sont assignés, sauf un superviseur qui a une vue et des droits sur l'ensemble des tickets |
| RM-05 | Le système doit rester fonctionnel (diagnostic en mode dégradé) si l'Agent IA ou le service RAG est indisponible |

## 2. Diagramme global des cas d'utilisation

```
                                    AI Help Desk

     ┌──────────┐                                              ┌──────────────┐
     │ Employé  │                                              │  Agent IA     │
     └────┬─────┘                                              └──────┬────────┘
          │                                                            │
          ├─ Créer une demande ──────────────┐                         ├─ Diagnostiquer
          ├─ Discuter avec l'IA              │                         ├─ Poser des questions
          ├─ Suivre un ticket                ▼                         ├─ Chercher dans la KB (RAG)
          ├─ Ajouter des informations   Assistant IA ──► Créer Ticket  ├─ Générer des scripts
          ├─ Joindre des fichiers            │                │       ├─ Résumer les tickets
          └─ Évaluer la résolution           │                ▼       └─ Recommander des actions
                                              │        Prioriser + Assigner
                                              ▼                │
                                     Résolution automatique    ▼
                                     (si non sensible)   ┌───────────┐
                                              │           │ Technicien │
                                              ▼           └─────┬──────┘
                                       Fermeture du ticket       │
                                                                  ├─ Consulter les tickets
     ┌──────────────┐                                            ├─ Prendre un ticket
     │ Superviseur   │                                           ├─ Réassigner
     └──────┬────────┘                                           ├─ Demander des informations
            │                                                    ├─ Exécuter une automatisation*
            ├─ Voir tous les tickets                              └─ Clôturer un ticket
            ├─ Modifier les priorités
            ├─ Réassigner                          ┌──────────────────┐
            ├─ Gérer les SLA                        │  Administrateur   │
            ├─ Voir les statistiques                └─────────┬─────────┘
            ├─ Gérer les équipes                              │
            └─ Approuver une action sensible*                 ├─ Gérer les utilisateurs et rôles
                                                               ├─ Configurer l'IA
     * Toute action sensible proposée par l'Agent IA           ├─ Configurer Microsoft Graph / Intune / AD
       ou un Technicien passe par une approbation              └─ Gérer les modèles d'automatisation
       (Technicien ou Superviseur) — voir UC-022 et RM-01.
```

*Un diagramme UML formel (cas d'utilisation, avec relations `<<include>>` et `<<extend>>`) sera produit séparément avant le développement du module Automation, une fois les scénarios ci-dessous validés.*

## 3. Acteurs — résumé des responsabilités

| Acteur | Actions principales |
|---|---|
| **Employé** | Créer une demande, discuter avec l'IA, suivre un ticket, ajouter des informations, joindre des fichiers, évaluer la résolution |
| **Technicien** | Consulter les tickets, prendre un ticket, réassigner, demander des informations, exécuter une automatisation (non sensible ou approuvée), clôturer un ticket |
| **Superviseur** | Voir tous les tickets, modifier les priorités, réassigner, gérer les SLA, voir les statistiques, gérer les équipes, approuver les actions sensibles |
| **Administrateur** | Gérer les utilisateurs et rôles, configurer l'IA, configurer Microsoft Graph/Intune/Active Directory, gérer les modèles d'automatisation |
| **Agent IA** | Diagnostiquer, poser des questions, chercher dans la documentation (RAG), générer des scripts, résumer les tickets, recommander des actions |

## 4. Catalogue des cas d'utilisation

| ID | Nom | Acteur principal | Version |
|---|---|---|---|
| UC-001 | Créer une demande d'assistance | Employé | V1 |
| UC-002 | Consulter l'historique de mes tickets | Employé | V1 |
| UC-003 | Joindre un fichier à une demande | Employé | V2 |
| UC-004 | Évaluer la résolution d'un ticket | Employé | V2 |
| UC-005 | Consulter la base de connaissances | Employé / Technicien | V4 |
| UC-010 | Prendre en charge un ticket | Technicien | V1 |
| UC-011 | Réassigner un ticket | Technicien / Superviseur | V1 |
| UC-012 | Demander des informations complémentaires | Technicien | V2 |
| UC-013 | Clôturer un ticket | Technicien | V1 |
| UC-014 | Exécuter une automatisation non sensible | Technicien | V5 |
| UC-015 | Résolution automatique (IA) | Agent IA | V4 |
| UC-020 | Gérer les SLA et priorités | Superviseur | V2 |
| UC-021 | Consulter les statistiques d'équipe | Superviseur | V2 |
| UC-022 | Approbation d'une action sensible | Superviseur / Technicien | V5 |
| UC-030 | Configurer les intégrations (Graph, Intune, AD, IA) | Administrateur | V5 |
| UC-031 | Gérer les utilisateurs et les rôles | Administrateur | V1 |

---

## 5. Spécifications détaillées

### UC-001 — Créer une demande d'assistance

**Objectif** : Permettre à un employé de signaler un problème informatique.
**Acteur principal** : Employé
**Préconditions** : Utilisateur connecté, compte actif
**Déclencheur** : L'utilisateur clique sur « Nouvelle demande »

**Scénario principal**
1. L'utilisateur décrit son problème
2. L'Agent IA identifie la catégorie
3. L'Agent IA pose des questions complémentaires si nécessaire
4. L'utilisateur répond
5. L'Agent IA génère un diagnostic (cause probable + étapes)
6. L'utilisateur confirme que le problème persiste
7. Le système crée un ticket
8. Le ticket est priorisé (RM applicable selon mots-clés/contexte)
9. Le ticket est assigné automatiquement
10. Une confirmation est affichée (numéro, priorité, technicien, délai estimé)

**Variantes**
- L'utilisateur abandonne avant la fin (le brouillon n'est pas conservé en V1)
- L'IA ne comprend pas la description → demande de reformulation, puis proposition de créer un ticket générique si l'ambiguïté persiste

**Cas d'erreur**
- Service IA indisponible → bascule sur diagnostic local (mots-clés), RM-05
- Réseau indisponible → message d'erreur, possibilité de réessayer
- Session expirée → redirection vers la connexion, description non perdue si possible
- Aucun technicien disponible dans la catégorie → assignation au technicien généraliste le moins chargé, toutes catégories confondues

**Postconditions** : Ticket créé, historique mis à jour, notification envoyée au technicien assigné

---

### UC-002 — Consulter l'historique de mes tickets

**Objectif** : Permettre à un employé de suivre l'état de ses demandes passées et actives.
**Acteur principal** : Employé
**Préconditions** : Utilisateur connecté

**Scénario principal**
1. L'utilisateur accède à l'onglet « Historique »
2. Le système affiche la liste des tickets de l'utilisateur, triés du plus récent au plus ancien
3. L'utilisateur peut filtrer par statut (Nouveau, En cours, Résolu, Escaladé)
4. L'utilisateur peut ouvrir un ticket pour voir le détail complet

**Cas d'erreur**
- Aucun ticket existant → message d'état vide, invitation à créer une nouvelle demande

**Postconditions** : Aucune (consultation seule)

---

### UC-010 — Prendre en charge un ticket

**Objectif** : Permettre à un technicien de démarrer formellement le traitement d'un ticket qui lui est assigné.
**Acteur principal** : Technicien
**Préconditions** : Ticket assigné au technicien connecté, statut « Nouveau »

**Scénario principal**
1. Le technicien consulte son tableau de bord
2. Le technicien sélectionne un ticket et clique « Prendre en charge »
3. Le système change le statut à « En cours »
4. Le système notifie l'employé du changement de statut

**Cas d'erreur**
- Le ticket a déjà été pris en charge par un autre technicien (cas de concurrence) → message d'erreur, rafraîchissement de la liste

**Postconditions** : Statut du ticket mis à jour, horodatage de prise en charge enregistré (utile pour le calcul de respect du SLA)

---

### UC-013 — Clôturer un ticket

**Objectif** : Permettre à un technicien de marquer un ticket comme résolu.
**Acteur principal** : Technicien
**Préconditions** : Ticket assigné au technicien connecté

**Scénario principal**
1. Le technicien sélectionne un ticket en cours
2. Le technicien clique « Résoudre » et ajoute une note de résolution (optionnelle en V1, requise en V2)
3. Le système change le statut à « Résolu »
4. Le système notifie l'employé, avec une invitation à évaluer la résolution (UC-004, V2)

**Postconditions** : Statut mis à jour, ticket déplacé vers « Résolus récemment » du technicien, disponible pour analyse statistique (Agent Manager)

---

### UC-015 — Résolution automatique

**Objectif** : Permettre à l'Agent IA de résoudre automatiquement certains incidents **non sensibles**, sans intervention humaine.

> **Note de conception (RM-03)** : Cette autonomie est strictement limitée aux actions réversibles et sans impact de sécurité — par exemple, redémarrer un service applicatif, vider un cache, réinitialiser un paramètre d'affichage. Une action touchant un compte, une permission ou une identité **ne peut jamais** passer par ce cas d'utilisation ; elle doit obligatoirement passer par UC-022.

**Acteur principal** : Agent IA
**Préconditions** : Le problème décrit correspond à un scénario connu et non sensible dans la base de connaissances

**Scénario principal**
1. L'utilisateur décrit un problème
2. L'Agent IA identifie une solution connue avec un niveau de confiance ≥ 95 % **et** confirme que l'action associée est classée non sensible (RM-03)
3. L'Agent IA propose la réparation automatique et explique l'action exacte qui sera prise
4. L'utilisateur accepte
5. Le système exécute l'action (script non sensible ou correction de configuration)
6. Le problème est vérifié comme corrigé
7. Le ticket est fermé automatiquement (aucun ticket n'a besoin d'être ouvert si la résolution est immédiate)
8. Une entrée de documentation est générée pour enrichir la base de connaissances (Agent Documentation)

**Cas d'erreur**
- L'action échoue à l'exécution → le système bascule sur la création d'un ticket standard (UC-001, étape 7) avec le contexte de la tentative automatique inclus
- Le niveau de confiance est insuffisant → le système ne propose pas de résolution automatique, poursuit le diagnostic conversationnel standard

**Postconditions** : Problème résolu sans ticket (cas nominal) ou ticket créé avec contexte enrichi (cas d'échec)

---

### UC-020 — Gérer les SLA et priorités

**Objectif** : Permettre à un superviseur de définir et ajuster les délais de traitement attendus par priorité.
**Acteur principal** : Superviseur
**Préconditions** : Utilisateur connecté avec rôle Superviseur

**Scénario principal**
1. Le superviseur accède aux paramètres SLA
2. Le superviseur définit un délai maximal par niveau de priorité (ex. Urgente : 1h, Moyenne : 4h, Faible : 24h)
3. Le système applique ces seuils aux nouveaux tickets
4. Le système déclenche une escalade automatique si un ticket dépasse son SLA sans prise en charge

**Postconditions** : Configuration SLA enregistrée, appliquée à tous les tickets futurs

---

### UC-022 — Approbation d'une action sensible

**Objectif** : Garantir qu'aucune action à impact de sécurité proposée par l'Agent IA ou un technicien n'est exécutée sans validation humaine explicite.
**Acteur principal** : Superviseur ou Technicien habilité
**Acteur secondaire** : Agent IA (initiateur de la proposition)
**Préconditions** : Une action sensible a été identifiée comme nécessaire (ex. via un diagnostic ou une demande explicite du technicien)

**Exemples d'actions concernées** : débloquer un compte Active Directory, réinitialiser un mot de passe, supprimer une boîte mail, exécuter un script PowerShell à portée système

**Scénario principal**
1. Le système détecte qu'il s'agit d'une action sensible (RM-01)
2. Le système prépare la proposition complète : action exacte, cible, justification, impact estimé
3. Le système demande une validation explicite au technicien ou au superviseur habilité
4. L'approbateur consulte les détails et approuve (ou rejette)
5. Le système journalise l'approbation (identité, horodatage, justification) — RM-02
6. Le système exécute l'action approuvée
7. Le système enregistre le résultat de l'exécution pour l'audit

**Variantes**
- L'approbateur rejette l'action → le système journalise le rejet, aucune exécution n'a lieu, le ticket reste ouvert pour une résolution manuelle
- L'approbateur demande une modification (ex. cible différente) → retour à l'étape 2 avec les ajustements

**Cas d'erreur**
- L'exécution échoue après approbation → le système journalise l'échec et notifie l'approbateur, aucune nouvelle tentative automatique

**Postconditions** : Action exécutée ou rejetée, entrée d'audit complète et consultable par l'Administrateur

---

### UC-031 — Gérer les utilisateurs et les rôles

**Objectif** : Permettre à un administrateur de gérer les comptes applicatifs et leurs permissions.
**Acteur principal** : Administrateur
**Préconditions** : Utilisateur connecté avec rôle Administrateur

**Scénario principal**
1. L'administrateur consulte la liste des utilisateurs (synchronisée depuis Microsoft Graph)
2. L'administrateur assigne ou modifie le rôle applicatif d'un utilisateur (employé, technicien, superviseur, administrateur)
3. L'administrateur associe un technicien à une ou plusieurs spécialités (réseau, matériel, logiciel, accès)
4. Le système applique les nouvelles permissions immédiatement

**Cas d'erreur**
- Conflit avec les groupes Microsoft Entra ID existants → le système signale l'incohérence sans l'appliquer automatiquement, laisse la décision à l'administrateur

**Postconditions** : Rôles et spécialités mis à jour, journalisés (action administrative)

---

## 6. Cas d'utilisation restants (catalogue à détailler ultérieurement)

Les cas suivants sont identifiés mais seront détaillés au fur et à mesure de leur implémentation (par version) : UC-003, UC-004, UC-005, UC-011, UC-012, UC-014, UC-021, UC-030.
