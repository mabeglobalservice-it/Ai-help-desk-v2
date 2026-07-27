# 10 — Architecture RAG (Retrieval-Augmented Generation) : AI Help Desk

## Objectif

Concevoir un système permettant à l'IA de répondre en s'appuyant sur les connaissances réelles de l'entreprise plutôt que sur la seule connaissance générale du modèle de langage — réduisant les hallucinations et rendant chaque réponse traçable à une source vérifiable.

```
Question utilisateur → Recherche documentaire → Documents pertinents → LLM → Réponse contextualisée
```

## 1. Vision du RAG

| Objectif | Bénéfice |
|---|---|
| Réduire les hallucinations | Le modèle s'appuie sur des extraits réels plutôt que sur des suppositions |
| Utiliser la documentation interne | Réponses adaptées à l'environnement réel de l'organisation, pas génériques |
| Réutiliser les anciens tickets | Capitalise sur l'expérience déjà accumulée par l'équipe |
| Fournir des réponses vérifiables | Chaque réponse peut citer sa source (document, section) |
| Conserver les connaissances de l'entreprise | Le savoir ne part pas avec le départ d'un technicien |

## 2. Sources de connaissances

| Source | Exemples |
|---|---|
| Procédures internes | Guides de dépannage propres à l'organisation |
| Base de connaissances / FAQ | Articles rédigés par l'équipe IT |
| Anciens tickets résolus | Solutions déjà validées en contexte réel |
| Manuels constructeurs | Documentation Microsoft, Cisco, VMware |
| Guides Intune / Active Directory | Procédures d'administration |
| Politiques internes | Règles de sécurité, conformité |
| Scripts PowerShell validés | Automatisations approuvées et réutilisables |
| Wikis d'entreprise | Connaissance collective informelle |

Chaque source possède un **niveau de confiance** (ex. un manuel constructeur officiel > une note wiki non validée) et un **propriétaire** (responsable de la mise à jour et de la validité).

## 3. Pipeline d'ingestion

```
Document → Extraction du texte → Nettoyage → Découpage (chunking) → Métadonnées → Embedding → Stockage (PostgreSQL + pgvector)
```

Ce pipeline est commun à toutes les sources, quel que soit leur format d'origine (PDF, Word, Excel, texte brut de ticket, page wiki).

## 4. Nettoyage des documents

Avant indexation, le système :
- Supprime les en-têtes et pieds de page répétitifs
- Élimine les doublons (par hash de contenu)
- Normalise les caractères (encodage, espaces, ponctuation)
- Conserve les tableaux et listes lorsqu'ils sont porteurs de sens
- Détecte la langue (pertinent puisque Mabe travaille en contexte francophone avec documentation souvent anglophone — Microsoft, Cisco)

## 5. Stratégie de chunking

Le découpage respecte la structure logique du document plutôt qu'une longueur fixe arbitraire : un manuel de 100 pages n'est jamais tronqué au milieu d'une procédure. Priorité au découpage par titres, sections, sous-sections et étapes numérotées, avec un léger chevauchement entre blocs consécutifs pour préserver le contexte aux frontières.

Chaque chunk conserve des métadonnées : titre, document d'origine, version, auteur, date de mise à jour, niveau de connaissance (voir section 13), niveau d'accès requis.

## 6. Génération des embeddings

Chaque chunk est transformé en vecteur, avec les métadonnées suivantes conservées en parallèle (dans `embeddings`/`documents`, document 08) : document source, section, catégorie, langue, auteur, date, version, score de confiance de la source.

## 7. Base vectorielle

**Choix retenu** : PostgreSQL + extension pgvector.

**Justification** :
- Une seule base de données à administrer (cohérent avec le reste de l'architecture, document 07)
- Excellente intégration avec Prisma
- Suffisant pour le volume attendu en V1-V4

Une base vectorielle dédiée (ex. Pinecone, Weaviate) reste une option d'évolution si le volume ou les besoins de recherche hybride (sémantique + lexicale à grande échelle) l'exigent — décision à réévaluer, pas à anticiper prématurément.

## 8. Pipeline de recherche

```
Question → Embedding → Recherche vectorielle → Top K résultats → Filtrage (droits d'accès) → Reranking → Contexte → LLM → Réponse
```

Paramètres à documenter et ajuster empiriquement lors du développement :
- **K** (nombre de résultats initiaux retournés par la recherche vectorielle, ex. 10-20)
- **Seuil de similarité minimal** (en dessous duquel un résultat est écarté plutôt que forcé dans le contexte)
- **Stratégie de reranking** (ex. un second passage qui réordonne les K résultats selon leur pertinence réelle à la question, pas seulement leur proximité vectorielle brute)

## 9. Agent Documentation — rôle précisé

Cet agent (déjà introduit au document 09) ne répond **jamais directement à l'utilisateur** — il fournit un contexte fiable aux autres agents (Diagnostic, Technicien, Help Desk).

**Responsabilités** :
- Rechercher les informations pertinentes à travers les sources autorisées
- Comparer plusieurs sources et **détecter les contradictions** (ex. une procédure interne obsolète qui contredit un guide constructeur plus récent)
- Résumer les procédures longues en contexte exploitable
- **Citer systématiquement les sources utilisées**, pour la traçabilité
- Signaler explicitement lorsque la confiance de la recherche est faible, plutôt que de forcer une réponse peu fiable

## 10. Sécurité documentaire

Toutes les connaissances ne sont pas accessibles à tous les rôles. Le système applique un filtrage par droits d'accès **avant** que les résultats n'atteignent le LLM — pas après :

| Rôle | Accès typique |
|---|---|
| Employé | FAQ publique, procédures grand public |
| Technicien | + procédures internes, anciens tickets, scripts non sensibles |
| Superviseur | + statistiques, tendances, historique complet |
| Administrateur | Accès complet, y compris configuration des sources |

Un utilisateur ne peut jamais recevoir, même indirectement via une réponse générée, une information provenant d'un document auquel il n'a pas accès — le filtrage se fait à l'étape de recherche (section 8), pas en post-traitement du texte généré.

## 11. Apprentissage continu

```
Ticket résolu → Résumé généré (IA) → Validation par un technicien → Proposition d'article → Indexation après validation
```

La qualité du RAG s'améliore ainsi progressivement, mais **jamais sans validation humaine** — un résumé de ticket généré automatiquement n'entre dans la base de connaissances qu'après approbation explicite, ce qui évite la propagation d'erreurs ou de solutions incomplètes dans le système documentaire.

## 12. Supervision et qualité

| Indicateur | Utilité |
|---|---|
| Taux de réponses pertinentes | Mesure la qualité perçue par les utilisateurs (via `ai_feedback`, document 08) |
| Taux de réutilisation des documents | Identifie les sources réellement utiles vs. celles qui ne ressortent jamais |
| Score moyen de confiance | Tendance générale de la fiabilité du système |
| Temps de recherche | Performance, expérience utilisateur |
| Coût des appels IA | Contrôle budgétaire |
| Documents les plus consultés | Priorisation de la maintenance documentaire |
| Documents obsolètes | Détecte les sources à réviser ou retirer (ex. non consultées depuis longtemps, ou systématiquement écartées par le reranking) |

## 13. Amélioration proposée — RAG multi-niveaux

Plutôt qu'une base documentaire unique, la connaissance est organisée en **5 niveaux**, chacun avec ses propres règles d'accès et de confiance :

| Niveau | Contenu |
|---|---|
| 1 — Connaissances publiques | Documentation Microsoft, Cisco, VMware, guides constructeurs |
| 2 — Connaissances internes | Procédures, FAQ, guides propres à l'organisation |
| 3 — Tickets résolus | Incidents, correctifs, solutions validées |
| 4 — Automatisation | Scripts PowerShell/Bash validés, procédures Intune, actions Active Directory |
| 5 — Connaissances personnelles | Notes, scripts et procédures favorites propres à chaque technicien |

L'Agent Documentation interroge ces niveaux dans un ordre défini (typiquement : personnel → interne → tickets résolus → public, en donnant priorité à ce qui est le plus contextualisé à l'organisation), applique les droits d'accès à chaque niveau, fusionne les résultats pertinents et transmet un contexte cohérent — avec attribution du niveau d'origine — au modèle de langage.

**Implication sur le schéma de données (document 08)** : la table `documents` doit inclure un champ `knowledge_level` (1 à 5) et un champ `owner_id` (nullable, renseigné uniquement pour le niveau 5), afin que le filtrage par niveau et par propriétaire soit appliqué au moment de la recherche vectorielle, pas en post-traitement.

**Pourquoi cette approche est un différenciateur** : la majorité des implémentations RAG se limitent à « PDF → embeddings → recherche → LLM », sans distinction de niveau de confiance, de droits d'accès ou de validation humaine. Un RAG structuré par niveaux, avec apprentissage continu validé et sécurité documentaire intégrée dès la conception, transforme le système d'un simple chatbot connecté à un LLM en un véritable **moteur de connaissance d'entreprise**.

## 14. Livrables de ce document

- Pipeline complet d'ingestion et de recherche (sections 3 et 8)
- Stratégie de chunking et de gestion des métadonnées (sections 5-6)
- Rôle précisé de l'Agent Documentation, y compris ses limites (jamais de réponse directe à l'utilisateur)
- Modèle de sécurité documentaire par rôle (section 10)
- Architecture RAG multi-niveaux (section 13), avec son implication directe sur le schéma de base de données (document 08)
- Indicateurs de supervision et de qualité continue (section 12)

Ce document alimente le **document 11 — Documentation API** (endpoints de recherche et d'ingestion) et le **document 12 — Plan de développement**, où la mise en œuvre du RAG sera phasée (probablement V4, une fois le socle ITSM en place).
