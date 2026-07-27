# 01 — Vision produit : AI Help Desk

## 1. Énoncé de vision

> Donner à chaque employé un premier réflexe simple et fiable face à un problème informatique — décrire, comprendre, résoudre ou escalader intelligemment — pour que le support IT interne passe moins de temps à trier et plus de temps à résoudre les vrais problèmes.

## 2. Le problème

Dans la plupart des organisations, le support informatique de premier niveau souffre des mêmes symptômes :

- Un volume élevé de demandes répétitives et simples (mot de passe, accès, redémarrage) qui monopolisent le temps des techniciens
- Un triage manuel lent : un employé décrit son problème dans un courriel ou un appel, un technicien doit reformuler, catégoriser et prioriser avant même de commencer à diagnostiquer
- Une absence de visibilité pour l'employé sur l'avancement de sa demande une fois soumise
- Des techniciens qui reçoivent des tickets mal catégorisés ou incomplets, ce qui rallonge le temps de résolution

## 3. La solution

AI Help Desk est un outil de support informatique interne qui :

1. Permet à un employé de décrire son problème en langage naturel
2. Propose un diagnostic immédiat avec des étapes de résolution guidées
3. Génère un ticket structuré et complet si le problème persiste — catégorisé, priorisé et assigné automatiquement
4. Donne aux techniciens une vue centralisée et priorisée de leur charge de travail
5. Reste fonctionnel même sans dépendance à un service d'IA externe, grâce à un mécanisme de repli local

## 4. Public cible

| Segment | Besoin principal |
|---|---|
| Employé (utilisateur final) | Résoudre rapidement un problème simple sans attendre un technicien, ou obtenir un ticket bien documenté sinon |
| Technicien de support (niveau 1-2) | Recevoir des tickets déjà triés, priorisés et contextualisés |
| Superviseur / gestionnaire IT | Visibilité sur le volume, les délais de résolution et la charge par technicien |

## 5. Proposition de valeur

- **Pour l'employé** : autonomie et rapidité — un problème résolu en quelques minutes plutôt qu'un ticket qui attend dans une file
- **Pour le technicien** : des tickets exploitables dès la réception, sans avoir à reformuler ou re-catégoriser
- **Pour l'organisation** : une réduction mesurable du volume de tickets de premier niveau et du temps moyen de résolution

## 6. Objectifs mesurables (indicateurs de succès)

| Indicateur | Cible visée |
|---|---|
| Taux de résolution en libre-service (sans création de ticket) | ≥ 40 % des demandes |
| Temps moyen de résolution des tickets de priorité moyenne/faible | Réduction de 30 % par rapport au processus manuel |
| Précision de la catégorisation automatique | ≥ 90 % (validée par le technicien receveur) |
| Disponibilité du service (indépendamment de l'IA externe) | 100 %, grâce au mécanisme de repli local |

## 7. Ce que le produit n'est pas (hors périmètre)

- Ce n'est pas un remplacement des techniciens — c'est un outil de triage et d'assistance au premier niveau
- Ce n'est pas un outil de gestion d'actifs informatiques (inventaire, licences)
- Ce n'est pas, dans sa version actuelle, un outil multi-organisation ou multi-tenant

## 8. Principes directeurs

1. **Résilience avant sophistication** — le système doit rester utilisable même si une dépendance externe (API IA) échoue
2. **Transparence du raisonnement** — l'employé voit toujours pourquoi une catégorie/priorité a été choisie avant la création du ticket
3. **Le serveur fait autorité** — aucune décision de sécurité ou de logique métier ne doit pouvoir être influencée depuis le navigateur
4. **Simplicité d'abord** — chaque fonctionnalité ajoutée doit se justifier par un vrai gain pour l'employé ou le technicien, pas par la nouveauté technologique

## 9. Horizon d'évolution

- **Court terme (V1)** : diagnostic + ticket + assignation, fonctionnel et déployé
- **Moyen terme (V2)** : documentation professionnelle complète, architecture RAG pour un diagnostic contextualisé à une vraie base de connaissances d'entreprise, notifications, recherche avancée
- **Long terme** : tableau de bord analytique, intégration à des outils tiers (Slack, Teams, systèmes de tickets existants comme Jira Service Management)
