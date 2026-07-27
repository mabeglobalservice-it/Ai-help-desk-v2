# 09 — Architecture des agents IA : AI Help Desk

## 1. Objectif

Détailler le fonctionnement interne de chaque agent IA introduit au document 07 (section 5) : son rôle précis, ses entrées/sorties, les outils auxquels il a accès, sa structure de prompt, et surtout comment les règles métier de sécurité (RM-01 à RM-05, document 06) s'appliquent concrètement à son comportement.

## 2. Vue d'ensemble — rôle de l'orchestrateur

L'**Orchestrateur IA** est le point d'entrée unique de toute requête impliquant l'IA. Il ne diagnostique ni n'exécute rien lui-même — il route vers le ou les agents appropriés et applique les garde-fous transversaux.

**Responsabilités de l'orchestrateur** :
1. Recevoir la requête (message utilisateur, contexte du ticket, historique de conversation)
2. Déterminer quel(s) agent(s) solliciter, dans quel ordre
3. Transmettre le contexte pertinent à chaque agent (jamais tout l'historique brut — seulement ce qui est nécessaire, pour limiter le coût et le bruit)
4. Agréger les réponses des agents en une réponse cohérente
5. **Appliquer RM-01 systématiquement** : si un agent retourne une action classée sensible, l'orchestrateur intercepte la réponse et la redirige vers le flux d'approbation (UC-022) avant qu'elle n'atteigne l'utilisateur sous forme d'action exécutée
6. Journaliser chaque appel (agent sollicité, temps de réponse, coût, résultat) dans `ai_conversations` / `ai_messages`

## 3. Spécification par agent

### 3.1 Agent Diagnostic

| Aspect | Détail |
|---|---|
| **Rôle** | Poser les bonnes questions, analyser les symptômes décrits, déterminer une cause probable |
| **Entrée** | Description du problème (texte libre), historique de la conversation en cours |
| **Sortie** | `{ categorie, cause_probable, etapes_suggerees[], priorite, confidence_score }` |
| **Outils accessibles** | Lecture seule : recherche dans `ai_conversations` passées similaires (via l'Agent Documentation) |
| **Sécurité** | Aucune action — purement informatif. Ne peut jamais initier une automatisation directement |
| **Fallback** | Si le fournisseur IA est indisponible, bascule sur la détection locale par mots-clés (RM-05) |

**Structure du prompt système (résumé)** : rôle de technicien de support niveau 1, contrainte de réponse en JSON structuré, règles de catégorisation et de priorité (héritées du prototype V1), instruction explicite de ne jamais halluciner d'informations sur l'environnement technique de l'organisation qu'il ne connaît pas.

### 3.2 Agent Help Desk

| Aspect | Détail |
|---|---|
| **Rôle** | Dialoguer directement avec l'employé, résoudre les cas simples, créer les tickets |
| **Entrée** | Message de l'employé, sortie de l'Agent Diagnostic |
| **Sortie** | Réponse conversationnelle, ou déclenchement de la création d'un ticket (UC-001) |
| **Outils accessibles** | Création de ticket (écriture non sensible), consultation de l'historique de l'employé |
| **Sécurité** | Peut créer un ticket de façon autonome (action non sensible) ; ne peut jamais accéder aux données d'un autre employé |

### 3.3 Agent Technicien

| Aspect | Détail |
|---|---|
| **Rôle** | Assister uniquement les techniciens — expliquer une panne, une commande, un script, une meilleure pratique |
| **Entrée** | Question du technicien, contexte du ticket en cours |
| **Sortie** | Explication textuelle, suggestion de commande ou de script (non exécuté directement) |
| **Outils accessibles** | Lecture de la base documentaire (via Agent Documentation), lecture de l'historique CMDB du CI concerné |
| **Sécurité** | Génère des scripts mais **ne les exécute jamais** — la génération de script transite obligatoirement par l'Agent Automation pour toute exécution, avec approbation |

### 3.4 Agent Documentation

| Aspect | Détail |
|---|---|
| **Rôle** | Rechercher dans les anciens tickets, procédures, PDF, FAQ (cœur du RAG, détaillé au document 10) |
| **Entrée** | Requête de recherche (texte ou vecteur déjà calculé) |
| **Sortie** | Liste de documents/passages pertinents, classés par score de similarité |
| **Outils accessibles** | Recherche vectorielle en lecture seule (`embeddings` via pgvector) |
| **Sécurité** | Aucune action d'écriture ; ne retourne que des extraits, jamais de documents entiers hors contexte (limite de longueur appliquée) |

### 3.5 Agent Automation

| Aspect | Détail |
|---|---|
| **Rôle** | Préparer l'exécution de scripts, actions Intune, Active Directory, Microsoft Graph |
| **Entrée** | Action demandée (par un technicien ou suggérée par l'Agent Diagnostic), contexte du ticket/CI |
| **Sortie** | Une **proposition structurée** : `{ action, cible, script_ou_appel_api, justification, is_sensitive, impact_estime }` |
| **Outils accessibles** | Lecture (statut Intune, conformité) en autonomie ; écriture (scripts, actions AD/Graph) **uniquement après approbation** |
| **Sécurité** | **RM-01 s'applique strictement** : toute sortie avec `is_sensitive = true` est interceptée par l'orchestrateur et redirigée vers UC-022. Cet agent ne possède techniquement pas les permissions d'exécution directe pour les actions sensibles — la séparation est appliquée au niveau du service, pas seulement du prompt |

> **Point d'architecture critique** : la distinction sensible/non-sensible n'est **pas** laissée à la discrétion du modèle de langage. Elle est déterminée par une table de référence (`scripts.is_sensitive`, ou une liste blanche d'actions Graph/Intune non sensibles) que l'agent consulte, et que seul un Administrateur peut modifier. Un LLM ne doit jamais être la seule autorité décidant si sa propre action est sûre.

### 3.6 Agent Manager (Supervisor)

| Aspect | Détail |
|---|---|
| **Rôle** | Analyser performances, respect des SLA, statistiques, tendances |
| **Entrée** | Requête d'un superviseur, ou exécution planifiée (rapport périodique) |
| **Sortie** | Statistiques agrégées, alertes de tendance (ex. hausse des pannes sur un modèle d'appareil) |
| **Outils accessibles** | Lecture seule sur `tickets`, `automation_runs`, `configuration_items` — jamais d'écriture |
| **Sécurité** | Purement analytique ; ne peut initier aucune action sur un ticket ou un CI |

### 3.7 Agent Inventory *(complète le pilier ITAM)*

| Aspect | Détail |
|---|---|
| **Rôle** | Répondre aux questions sur les actifs (garantie, licence, historique), enrichir le diagnostic avec le contexte CMDB |
| **Entrée** | Requête liée à un CI, ou identifiant de CI associé à un ticket |
| **Sortie** | Détails de l'actif, dépendances (`ci_relationships`), historique d'interventions |
| **Outils accessibles** | Lecture seule sur le domaine Inventaire/CMDB |
| **Sécurité** | Aucune action d'écriture sur les CI (la modification reste un acte administratif humain) |

## 4. Communication inter-agents

Les agents ne se parlent jamais directement entre eux — toute communication transite par l'orchestrateur, qui agit comme médiateur. Ça évite les boucles imprévues (ex. Agent Automation qui solliciterait indéfiniment l'Agent Diagnostic) et centralise le point de contrôle de sécurité.

```
Exemple — diagnostic enrichi par l'inventaire :

Utilisateur → Orchestrateur → Agent Diagnostic (analyse le symptôme)
                             → Agent Inventory (vérifie la conformité du CI concerné)
                             ← Orchestrateur agrège les deux réponses
                             → Réponse finale à l'utilisateur
```

## 5. Gestion des erreurs et repli

| Situation | Comportement |
|---|---|
| Fournisseur IA indisponible | Agent Diagnostic bascule sur mots-clés locaux (RM-05) ; les autres agents retournent une réponse dégradée ou différée |
| Confiance insuffisante (Agent Diagnostic) | Pas de résolution automatique proposée (UC-015 non déclenché), poursuite du diagnostic conversationnel standard |
| Timeout d'un agent | L'orchestrateur retourne une réponse partielle plutôt que de bloquer l'ensemble de la conversation |
| Sortie non conforme au schéma JSON attendu | Rejetée par une validation stricte (schema validation), nouvelle tentative avec un prompt renforcé, puis repli si échec répété |

## 6. Extensibilité

Ajouter un nouvel agent (ex. un futur "Agent Sécurité" dédié à la détection de tentatives de phishing signalées par les employés) ne nécessite que : (1) l'enregistrer dans `ai_agents`, (2) définir son prompt système et son schéma de sortie, (3) l'intégrer aux règles de routage de l'orchestrateur — sans modifier les agents existants, conformément au principe de responsabilité unique établi au document 07.

## 7. Livrables de ce document

- Spécification complète des 7 agents (rôle, entrées/sorties, outils, sécurité)
- Le mécanisme central garantissant RM-01 au niveau architectural, pas seulement au niveau du prompt
- Le protocole de communication inter-agents via l'orchestrateur
- La stratégie de repli en cas d'erreur ou d'indisponibilité

Ce document alimente directement le **document 10 — Architecture RAG** (détail de l'Agent Documentation) et le **document 11 — Documentation API** (endpoints exposant chaque agent).
