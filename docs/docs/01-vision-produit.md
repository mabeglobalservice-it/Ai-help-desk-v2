# 01 — Vision produit : AI Help Desk (v2)

## 1. Énoncé de vision

> Ne pas construire un simple logiciel de tickets, mais **le copilote intelligent des techniciens informatiques** — une plateforme qui combine support conversationnel, gestion IT (ITSM), gestion des actifs (ITAM), automatisation et intelligence documentaire, pour que chaque technicien gagne plusieurs heures par semaine grâce à l'IA.

## 2. Le problème

Les techniciens de support IT perdent une part disproportionnée de leur temps à des tâches à faible valeur ajoutée :

- Trier et reformuler des demandes mal décrites ou mal catégorisées
- Chercher manuellement dans des procédures, guides internes ou tickets passés similaires
- Exécuter des actions répétitives (déblocage de compte, réinitialisation, vérification de conformité d'appareil) qui pourraient être préparées ou partiellement automatisées
- Faire le suivi de l'état des actifs informatiques (garanties, licences, historique de réparation) dans des outils déconnectés du système de tickets

Résultat : le temps réellement consacré au diagnostic et à la résolution de problèmes complexes est réduit, et l'organisation IT reste réactive plutôt que proactive.

## 3. La solution : les 5 piliers

### Pilier 1 — Support intelligent
Chat IA conversationnel, diagnostic contextualisé, création automatique de tickets, priorisation et suggestions d'étapes de résolution.

### Pilier 2 — Gestion IT (ITSM)
Gestion complète du cycle de vie des tickets : SLA, escalade automatique, historique, organisation par équipes et files d'attente spécialisées.

### Pilier 3 — Gestion des actifs (ITAM)
Inventaire des actifs informatiques (ordinateurs, écrans, imprimantes, serveurs), suivi des licences et garanties, historique des réparations — relié directement aux tickets (un ticket peut être associé à un actif précis).

### Pilier 4 — Automatisation
Exécution supervisée de scripts (PowerShell), actions Intune, Active Directory et Microsoft 365 — toujours avec validation humaine pour les actions à impact de sécurité.

### Pilier 5 — Intelligence
RAG et recherche documentaire, analyse prédictive (ex. anticiper les pannes récurrentes d'un modèle d'appareil), statistiques avancées, génération automatique de documentation (procédures, rapports).

## 4. Public cible

| Segment | Besoin principal |
|---|---|
| Employé (utilisateur final) | Résoudre rapidement un problème, ou obtenir un ticket bien documenté sinon |
| Technicien de support (niveau 1-2) | Un copilote qui trie, contextualise, prépare et parfois automatise les tâches répétitives |
| Superviseur / gestionnaire IT | Visibilité sur les SLA, la charge, les actifs, et validation des actions sensibles |
| Équipe sécurité / conformité | Traçabilité complète des actions automatisées et supervisées |

## 5. Proposition de valeur

- **Pour l'employé** : autonomie et rapidité de résolution
- **Pour le technicien** : un copilote qui élimine le travail répétitif de bas niveau — recherche, triage, préparation d'actions — pour se concentrer sur le diagnostic et la décision
- **Pour l'organisation** : réduction du temps de résolution, meilleure visibilité sur les actifs et les tendances, documentation qui se maintient elle-même

## 6. Objectifs mesurables (indicateurs de succès)

| Indicateur | Cible visée |
|---|---|
| Temps gagné par technicien par semaine | Plusieurs heures (cible qualitative initiale, à quantifier après mise en usage réelle) |
| Taux de résolution en libre-service | ≥ 40 % des demandes |
| Précision de la catégorisation automatique | ≥ 90 % |
| Respect des SLA | ≥ 95 % des tickets traités dans le délai contractuel |
| Disponibilité du service (indépendamment de l'IA externe) | 100 %, grâce au mécanisme de repli local |
| Actions sensibles exécutées sans validation humaine | 0 (tolérance zéro — exigence de sécurité, non un objectif d'optimisation) |

## 7. Ce que le produit n'est pas (hors périmètre)

- Ce n'est pas un remplacement des techniciens — c'est un copilote qui amplifie leur capacité
- Ce n'est pas, dans sa version initiale, un outil multi-organisation (multi-tenant)
- Ce n'est pas un système qui exécute des actions de sécurité de façon autonome, quelle que soit la confiance du modèle IA

## 8. Principes directeurs

1. **Résilience avant sophistication** — le système reste utilisable même si une dépendance externe (IA, RAG) échoue
2. **Le technicien garde le contrôle** — l'IA propose, le technicien décide et valide les actions sensibles
3. **Le serveur fait autorité** — aucune décision de sécurité ou de logique métier ne doit pouvoir être influencée depuis le client
4. **Traçabilité systématique** — toute action automatisée ou supervisée est journalisée avec identité, horodatage et justification
5. **Croissance par phases** — les 5 piliers ne sont pas construits simultanément ; chaque phase livre de la valeur avant d'aborder la suivante (voir document 11 — Plan de développement)

## 9. Feuille de route par pilier (aperçu — détaillée au document 11)

| Phase | Pilier(s) couvert(s) | Statut |
|---|---|---|
| V1 (prototype) | Pilier 1 (partiel) — diagnostic, tickets, assignation | Réalisé |
| V2 | Pilier 1 complet + Pilier 2 (ITSM — SLA, escalade, équipes) | En cours de conception |
| V3 | Pilier 3 (ITAM) | Planifié |
| V4 | Pilier 4 (Automatisation supervisée) | Planifié |
| V5 | Pilier 5 (Intelligence avancée — prédictif, documentation générative) | Vision long terme |
