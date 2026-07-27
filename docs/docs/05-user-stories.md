# 05 — User Stories : AI Help Desk

*Organisées par persona (voir document 04) et par version (voir feuille de route, document 00/01). Format standard : En tant que [rôle], je veux [action], afin de [bénéfice].*

## Légende de priorité

`P0` = essentiel au MVP · `P1` = important, peu après le MVP · `P2` = souhaitable, version ultérieure

---

## Version 1 — MVP (Pilier 1)

### Nathalie (employée)

| ID | User Story | Priorité |
|---|---|---|
| US-01 | En tant qu'employée, je veux décrire mon problème en langage naturel, afin de ne pas avoir à utiliser un vocabulaire technique que je ne maîtrise pas | P0 |
| US-02 | En tant qu'employée, je veux recevoir un diagnostic avec des étapes claires à suivre, afin de pouvoir résoudre moi-même les problèmes simples | P0 |
| US-03 | En tant qu'employée, je veux qu'un ticket soit créé automatiquement si les étapes proposées ne résolvent pas mon problème, afin de ne pas avoir à répéter mon problème à un technicien | P0 |
| US-04 | En tant qu'employée, je veux voir un numéro de ticket, la priorité et un délai estimé après la création, afin de savoir à quoi m'attendre | P0 |
| US-05 | En tant qu'employée, je veux consulter l'historique de mes demandes passées, afin de suivre leur progression | P0 |

### Marc-Antoine (technicien)

| ID | User Story | Priorité |
|---|---|---|
| US-06 | En tant que technicien, je veux me connecter avec une identité distincte des employés, afin d'accéder à mes outils spécifiques | P0 |
| US-07 | En tant que technicien, je veux voir uniquement les tickets qui me sont assignés, triés par priorité, afin de prioriser mon travail efficacement | P0 |
| US-08 | En tant que technicien, je veux voir les étapes déjà tentées par l'employé avant la création du ticket, afin de ne pas répéter un diagnostic déjà fait | P0 |
| US-09 | En tant que technicien, je veux pouvoir changer le statut d'un ticket (Prendre en charge, Résoudre), afin de refléter l'avancement réel de mon travail | P0 |
| US-10 | En tant que technicien, je veux pouvoir réassigner un ticket à un collègue, afin de gérer les cas où je ne suis pas disponible ou pas le bon spécialiste | P0 |
| US-11 | En tant que technicien, je veux que les nouveaux tickets m'apparaissent sans avoir à recharger la page, afin de réagir rapidement | P1 |

### Système / assignation

| ID | User Story | Priorité |
|---|---|---|
| US-12 | En tant que système, je dois catégoriser automatiquement chaque demande (réseau, matériel, logiciel, accès), afin d'accélérer le triage | P0 |
| US-13 | En tant que système, je dois assigner chaque ticket au technicien le moins chargé dans la bonne spécialité, afin d'équilibrer la charge de travail | P0 |
| US-14 | En tant que système, je dois rester fonctionnel même si le service d'IA externe est indisponible, afin de garantir la continuité du service | P0 |

---

## Version 2 — ITSM (Pilier 2)

### Sophie (superviseure)

| ID | User Story | Priorité |
|---|---|---|
| US-15 | En tant que superviseure, je veux définir des SLA par priorité de ticket, afin de garantir des délais de traitement contractuels | P1 |
| US-16 | En tant que superviseure, je veux qu'un ticket non pris en charge après un délai défini soit escaladé automatiquement, afin d'éviter les oublis | P1 |
| US-17 | En tant que superviseure, je veux organiser les techniciens en équipes spécialisées, afin de mieux structurer l'assignation | P1 |
| US-18 | En tant que superviseure, je veux recevoir des statistiques sur les délais et la charge par technicien, afin de justifier les besoins en ressources | P1 |

### Marc-Antoine (technicien)

| ID | User Story | Priorité |
|---|---|---|
| US-19 | En tant que technicien, je veux ajouter des commentaires sur un ticket, afin de documenter mon raisonnement ou demander plus d'informations à l'employé | P1 |
| US-20 | En tant qu'employé, je veux joindre une capture d'écran ou un fichier à ma demande, afin d'illustrer mon problème | P1 |
| US-21 | En tant qu'employé ou technicien, je veux recevoir une notification (email/Teams) lors d'un changement de statut, afin de ne pas avoir à vérifier manuellement | P1 |

---

## Version 3 — Inventaire (Pilier 3)

| ID | User Story | Priorité |
|---|---|---|
| US-22 | En tant que technicien, je veux associer un ticket à un actif spécifique (ordinateur, imprimante), afin de garder un historique de réparation par appareil | P2 |
| US-23 | En tant que superviseure, je veux consulter les licences et leur date d'expiration, afin d'anticiper les renouvellements | P2 |
| US-24 | En tant que technicien, je veux voir la garantie d'un appareil avant de décider d'une réparation, afin d'orienter la décision (réparer vs remplacer) | P2 |

---

## Version 4 — IA avancée (Pilier 5)

| ID | User Story | Priorité |
|---|---|---|
| US-25 | En tant qu'employé ou technicien, je veux que le diagnostic s'appuie sur les procédures internes réelles de l'entreprise (RAG), afin d'obtenir des réponses adaptées à mon contexte, pas génériques | P2 |
| US-26 | En tant que technicien, je veux rechercher dans les tickets passés similaires, afin de m'inspirer de résolutions déjà appliquées | P2 |
| US-27 | En tant que superviseure, je veux une analyse prédictive des pannes récurrentes par modèle d'appareil, afin d'anticiper les remplacements | P2 |

---

## Version 5 — Automatisation supervisée (Pilier 4)

| ID | User Story | Priorité |
|---|---|---|
| US-28 | En tant que technicien, je veux que le système prépare une action de déblocage de compte ou de réinitialisation de mot de passe, afin de gagner du temps sur la saisie manuelle | P2 |
| US-29 | En tant que technicien ou superviseure, je dois approuver explicitement toute action sensible avant son exécution, afin de garder le contrôle sur les actions à risque | P0 *(exigence de sécurité transversale, non négociable dès que ce module existe)* |
| US-30 | En tant qu'administrateur, je veux consulter un journal complet de toutes les actions sensibles proposées et exécutées, afin d'assurer la traçabilité et l'audit | P0 *(idem)* |

---

## Version 6 — Entreprise / SaaS

| ID | User Story | Priorité |
|---|---|---|
| US-31 | En tant qu'administrateur, je veux gérer plusieurs organisations clientes de façon isolée (multi-tenant), afin de commercialiser le produit à plusieurs entreprises | P2 |
| US-32 | En tant qu'administrateur, je veux exposer une API publique documentée, afin que des clients puissent intégrer AI Help Desk à leurs propres outils | P2 |

---

## Résumé de couverture par persona

| Persona | Nombre de user stories | Versions couvertes |
|---|---|---|
| Nathalie (employée) | 6 | V1, V2 |
| Marc-Antoine (technicien) | 10 | V1, V2, V3, V4, V5 |
| Sophie (superviseure) | 5 | V2, V3, V4 |
| David (administrateur) | 3 | V5, V6 |
| Système (automatisé) | 3 | V1 |
