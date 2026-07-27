# 02 — Business Requirements Document (BRD) : AI Help Desk

## 1. Objectif du document

Ce document traduit la vision produit (document 01) en exigences d'affaires concrètes : ce que le système doit accomplir du point de vue métier, indépendamment de l'implémentation technique détaillée (couverte dans les documents 05 à 09).

## 2. Parties prenantes

| Rôle | Intérêt dans le projet |
|---|---|
| Employé (utilisateur final) | Résolution rapide de problèmes IT, transparence sur le statut de sa demande |
| Technicien de support | Tickets bien triés, priorisés, exploitables sans reformulation |
| Superviseur IT | Visibilité sur la charge de l'équipe, les délais, la qualité du triage |
| Direction / gestion | Réduction des coûts de support de premier niveau, données pour justifier les ressources IT |
| Équipe sécurité / conformité | Respect des permissions d'accès existantes (via Active Directory), traçabilité des actions |

## 3. Contexte d'affaires

Le support informatique interne représente un centre de coût récurrent, souvent sous-dimensionné par rapport au volume de demandes. Une part significative de ces demandes (accès, mots de passe, redémarrages, questions générales) ne nécessite pas d'expertise humaine si l'employé dispose d'un outil de diagnostic fiable. Automatiser ce premier niveau libère les techniciens pour les cas à plus forte valeur ajoutée (incidents complexes, projets, sécurité).

## 4. Exigences d'affaires

### 4.1 Exigences essentielles (must-have)

| ID | Exigence | Justification |
|---|---|---|
| BR-01 | Le système doit permettre à un employé de soumettre un problème en langage naturel | Réduit la friction par rapport à un formulaire structuré |
| BR-02 | Le système doit catégoriser et prioriser automatiquement chaque demande | Élimine le triage manuel initial par un technicien |
| BR-03 | Le système doit assigner automatiquement les tickets non résolus à un technicien selon sa spécialité et sa charge | Équilibre la charge de travail sans intervention d'un superviseur |
| BR-04 | Le système doit s'authentifier via l'annuaire d'entreprise existant (Active Directory / Microsoft Graph) | Évite la duplication de comptes et respecte les permissions déjà en place |
| BR-05 | Le système doit rester fonctionnel même en cas d'indisponibilité du service d'IA externe | Continuité de service, indépendance face à un fournisseur tiers |
| BR-06 | Le système doit conserver un historique consultable par l'employé et le technicien | Traçabilité, transparence |

### 4.2 Exigences importantes (should-have)

| ID | Exigence | Justification |
|---|---|---|
| BR-07 | Le système doit permettre au technicien de corriger manuellement une catégorisation erronée | Fiabilité perçue du système, apprentissage continu |
| BR-08 | Le système doit notifier l'employé et le technicien lors des changements de statut d'un ticket | Réduit les relances et les demandes de suivi |
| BR-09 | Le système doit s'appuyer sur une base documentaire interne (RAG) pour contextualiser ses diagnostics | Précision accrue, adapté à l'environnement réel de l'entreprise |
| BR-10 | Le système doit fournir des statistiques agrégées aux superviseurs (volume, délais, charge par technicien) | Aide à la décision, justification des ressources |

### 4.3 Exigences souhaitables (nice-to-have)

| ID | Exigence |
|---|---|
| BR-11 | Export des tickets en formats CSV/PDF pour rapports périodiques |
| BR-12 | Intégration avec Microsoft Teams pour notifications et création de tickets |
| BR-13 | Tableau de bord analytique avec tendances historiques |

## 5. Contraintes

- **Conformité et sécurité** : le système ne doit jamais exposer ou permettre la modification de rôles/permissions côté client — toute décision d'autorisation doit être validée côté serveur
- **Dépendance externe** : l'usage de l'API Claude doit être optionnel sur le plan fonctionnel (mécanisme de repli obligatoire)
- **Intégration** : l'authentification et les informations utilisateur doivent pouvoir provenir d'Active Directory / Microsoft Graph plutôt que d'un système de comptes propriétaire
- **Budget** : la version de démonstration doit pouvoir fonctionner sur des services à coût minimal ou gratuit (paliers gratuits des fournisseurs cloud)

## 6. Hypothèses

- L'organisation cible dispose déjà d'un environnement Microsoft (Active Directory, Intune, Microsoft 365)
- Les techniciens sont regroupés par spécialité (réseau, matériel, logiciel, accès) dans l'annuaire ou dans une table de correspondance dédiée
- Le volume de tickets, dans un contexte réel, justifie l'automatisation (au-delà d'un certain seuil, le triage manuel devient le goulot d'étranglement)

## 7. Critères de succès du projet (côté affaires)

- Réduction mesurable du temps de triage initial (idéalement à zéro pour les cas résolus en libre-service)
- Adoption par les employés (taux d'utilisation volontaire plutôt que par email/téléphone)
- Confiance des techniciens dans la qualité du triage automatique (mesurée par le taux de correction manuelle des catégories/priorités — BR-07)

## 8. Hors périmètre (rappel du document 01)

- Gestion d'actifs informatiques (inventaire, licences logicielles)
- Support multi-organisation / multi-tenant
- Remplacement complet de l'intervention humaine pour les incidents complexes

## 9. Risques d'affaires identifiés

| Risque | Impact | Mitigation envisagée |
|---|---|---|
| Mauvaise catégorisation perçue comme peu fiable par les techniciens | Faible adoption | Permettre la correction manuelle (BR-07), affiner les prompts/mots-clés en continu |
| Dépendance à un fournisseur d'IA externe (coût, disponibilité) | Interruption de service ou coûts imprévus | Mécanisme de repli local obligatoire (BR-05) |
| Résistance au changement des employés habitués au support téléphonique/courriel | Sous-utilisation de l'outil | Communication interne, période de transition avec les deux canaux actifs |
