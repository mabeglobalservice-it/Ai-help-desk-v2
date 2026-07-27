# Documentation — AI Help Desk

Documentation de conception complète, produite avant le développement, suivant une méthode inspirée des pratiques professionnelles de gestion de produit.

| # | Document | Description |
|---|---|---|
| [00](./00-apercu-projet.md) | Aperçu du projet | Résumé exécutif — vision, piliers, stack, feuille de route |
| [01](./01-vision-produit.md) | Vision produit | Le copilote intelligent des techniciens IT, les 5 piliers |
| [02](./02-brd.md) | Business Requirements Document | Exigences d'affaires, parties prenantes, risques |
| [03](./03-cahier-des-charges-v2.md) | Cahier des charges V2 | Stack technique complète, modules fonctionnels |
| [04](./04-personas.md) | Personas | Employé, technicien, superviseur, administrateur |
| [05](./05-user-stories.md) | User Stories | 32 user stories organisées par version |
| [06](./06-cas-utilisation.md) | Cas d'utilisation | Scénarios fonctionnels détaillés (Use Cases) |
| [07](./07-architecture-logicielle.md) | Architecture logicielle | 12 chapitres — frontend, backend, IA, sécurité, cloud |
| [08](./08-schema-base-de-donnees.md) | Schéma de base de données | Dictionnaire de données, CMDB, extrait Prisma |
| [09](./09-architecture-agents-ia.md) | Architecture des agents IA | 7 agents spécialisés, orchestrateur, sécurité |
| [10](./10-architecture-rag.md) | Architecture RAG | Pipeline complet, RAG multi-niveaux |
| [11](./11-documentation-api.md) | Documentation API | Endpoints REST et événements WebSocket par module |
| [12](./12-maquettes-ui-ux.md) | Maquettes UI/UX | Système de design, wireframes des écrans clés |
| [13](./13-plan-developpement.md) | Plan de développement | Séquencement V1 à V6, critères de sortie, tests |
| [14](./14-plan-deploiement-cloud.md) | Plan de déploiement cloud | Environnements, CI/CD, infrastructure Azure cible |
| [15](./15-documentation-utilisateur-administrateur.md) | Documentation utilisateur/admin | Guides par rôle (employé, technicien, superviseur, admin) |

## Principe transversal

Un principe de sécurité traverse l'ensemble de cette documentation : **aucune action à impact de sécurité (déblocage de compte, réinitialisation de mot de passe, exécution de script système) n'est jamais exécutée automatiquement par l'IA sans validation humaine explicite.** Voir document 06 (règles métier RM-01 à RM-05) pour le détail.

## Auteur

Boubacar Bella Diallo (Mabe) — Technicien informatique, Laval, QC
