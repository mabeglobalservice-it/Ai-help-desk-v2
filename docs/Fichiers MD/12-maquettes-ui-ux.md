# 12 — Maquettes UI/UX : AI Help Desk

## 1. Objectif

Définir les principes visuels, la structure des écrans clés et le système de composants qui guideront le développement du frontend (Next.js + Tailwind + Shadcn UI), en cohérence avec l'identité déjà validée lors du prototype V1.

## 2. Système de design (Design Tokens)

| Token | Valeur | Usage |
|---|---|---|
| Couleur primaire | Bleu institutionnel (#1E3A5F, navy) | En-têtes, actions principales, confiance |
| Couleur d'accent | Terracotta (#C4694A) | Boutons d'action, priorité, éléments d'attention |
| Couleur de succès | Vert (#4C8C6B) | Statuts résolus, confirmations |
| Couleur d'alerte | Ambre (#D19A3D) | Statuts en cours, avertissements non critiques |
| Fond | Crème clair (#F7F3EC) | Arrière-plan général, sobre et lisible |
| Typographie titres | Police serif (ex. Georgia / Iowan Old Style) | En-têtes, identité éditoriale distincte d'un SaaS générique |
| Typographie corps | Police sans-serif système | Texte courant, lisibilité |
| Bibliothèque de composants | Shadcn UI (sur Tailwind CSS) | Boutons, formulaires, tables, dialogues, badges de statut |

Ce système reprend et formalise l'identité visuelle déjà établie et validée dans le prototype (Claude Design) : professionnelle, sobre, ni froide ni trop ludique — adaptée à un contexte d'entreprise incluant le secteur public.

## 3. Principes UX transversaux

- **Clarté avant densité** : chaque écran priorise l'action la plus probable (ex. créer une demande) plutôt que d'exposer toutes les fonctions en même temps
- **Statuts toujours codés par couleur et texte** (jamais couleur seule, pour l'accessibilité) : Nouveau (neutre), En cours (ambre), Résolu (vert), Escaladé (terracotta)
- **Actions sensibles visuellement distinctes** : tout bouton déclenchant une action nécessitant une approbation (module Automation) est visuellement marqué (icône de validation, libellé explicite « Proposer » plutôt que « Exécuter »)
- **Accessibilité** : contraste conforme WCAG AA minimum, navigation clavier complète, libellés explicites sur les icônes (pas d'icône seule sans texte ou `aria-label`)
- **Responsive** : priorité mobile pour les écrans employé (souvent consultés depuis un téléphone), priorité desktop pour les tableaux de bord technicien/superviseur (données denses)

## 4. Écrans clés

### 4.1 Connexion (SSO Microsoft)
```
┌─────────────────────────────────────┐
│         AI Help Desk                 │
│                                       │
│   Connectez-vous avec votre compte   │
│         professionnel                │
│                                       │
│   [ Se connecter avec Microsoft ]    │
│                                       │
└─────────────────────────────────────┘
```
Un seul point d'entrée (SSO Entra ID) — pas de formulaire nom/mot de passe séparé, cohérent avec l'architecture d'authentification (document 07).

### 4.2 Nouvelle demande (Employé)
```
┌───────────────────────────────────────────────────────────┐
│  AI Help Desk        [Nouvelle demande] [Historique]   MT │
├───────────────────────────────────────────────────────────┤
│  Votre assistant IT, disponible 24/7          [illustration]│
│  247 résolus · 3 min moyen · 98% satisfaction               │
├───────────┬───────────────────────────────────────────────┤
│ CATÉGORIES│  [Zone de conversation]                        │
│ Réseau    │  Bonjour ! Décrivez votre problème...           │
│ Matériel  │                                                 │
│ Logiciel  │  [Diagnostic + étapes à cocher]                │
│ Accès     │  [Bouton : Le problème persiste]               │
│           │  [Champ de saisie]           [Envoyer]         │
└───────────┴───────────────────────────────────────────────┘
```
Reprend directement la structure validée du prototype V1, enrichie des statistiques et catégories.

### 4.3 Tableau de bord technicien
```
┌───────────────────────────────────────────────────────────┐
│  Tableau de bord — R. Gagnon (Tech-007)   4 tickets actifs │
├───────────────────────────────────────────────────────────┤
│  🔴 URGENTE  TCK-2293 — Accès refusé — Compte/Auth         │
│     [Prendre en charge] [Résoudre] [Réassigner]            │
│  🟡 MOYENNE  TCK-2287 — VPN instable — Réseau              │
│     [Prendre en charge] [Résoudre] [Réassigner]            │
├───────────────────────────────────────────────────────────┤
│  RÉSOLUS RÉCEMMENT                                          │
│  ✓ TCK-2280 — Imprimante hors ligne                         │
└───────────────────────────────────────────────────────────┘
```
Tri par priorité déjà en place (validé V1) ; ajout prévu (V2) d'indicateurs de respect de SLA par ligne (ex. temps restant avant échéance).

### 4.4 File d'approbation (Superviseur / Technicien habilité) — nouveau, V5
```
┌───────────────────────────────────────────────────────────┐
│  Actions en attente d'approbation                    (2)  │
├───────────────────────────────────────────────────────────┤
│  ⚠ Réinitialisation de mot de passe                        │
│    Cible : j.tremblay@organisation.com                     │
│    Demandé par : Agent Automation (via ticket TCK-2301)    │
│    Justification : « Compte verrouillé après 5 tentatives »│
│    [ Approuver ]   [ Rejeter ]   [ Voir les détails ]      │
└───────────────────────────────────────────────────────────┘
```
Écran délibérément conçu pour ralentir légèrement l'action (justification visible, deux boutons de taille égale, pas de bouton pré-sélectionné) — évite l'approbation réflexe sans lecture (biais d'automatisation).

### 4.5 Tableau de bord superviseur (analytique)
```
┌───────────────────────────────────────────────────────────┐
│  Vue d'équipe                                               │
│  SLA respecté : 96%   Délai moyen : 42 min   Charge : ▓▓▓░ │
├───────────────────────────────────────────────────────────┤
│  Par technicien :                                            │
│  R. Gagnon    ▓▓▓▓▓░░░  5 actifs                             │
│  S. Bouchard  ▓▓░░░░░░  2 actifs                             │
├───────────────────────────────────────────────────────────┤
│  [Exporter le rapport (CSV/PDF)]                             │
└───────────────────────────────────────────────────────────┘
```

### 4.6 Recherche documentaire (RAG) — Technicien
```
┌───────────────────────────────────────────────────────────┐
│  🔍 [ recherche : "VPN se déconnecte" ]                     │
├───────────────────────────────────────────────────────────┤
│  📄 Procédure interne — Dépannage VPN (Niveau 2)  92% pert. │
│  🎫 Ticket TCK-2201 résolu — cas similaire (Niveau 3) 87%   │
│  📘 Guide Cisco AnyConnect (Niveau 1)              74%      │
└───────────────────────────────────────────────────────────┘
```
Chaque résultat affiche sa source et son niveau (document 10), pour que le technicien évalue lui-même la fiabilité avant de s'y fier.

### 4.7 Fiche Configuration Item (CMDB)
```
┌───────────────────────────────────────────────────────────┐
│  💻 PC-04521 — Poste de travail — Criticité : Moyenne      │
│  Propriétaire : N. Roy · Garantie : jusqu'au 2027-03-15    │
├───────────────────────────────────────────────────────────┤
│  Dépendances :                                               │
│   └─ Application « Gestion des horaires » (runs_on)         │
│  Historique d'interventions : 3 tickets (2 résolus, 1 actif)│
└───────────────────────────────────────────────────────────┘
```

## 5. Composants Shadcn UI identifiés comme prioritaires

`Button`, `Card`, `Badge` (statuts colorés), `Dialog` (approbation d'action sensible), `Table` (historique, inventaire), `Tabs` (navigation principale), `Command` (recherche documentaire type palette de commande), `Toast` (notifications temps réel), `Progress` (barres de charge technicien), `Avatar`.

## 6. Prochaine étape de production visuelle

Ce document définit la structure et les principes ; la production de véritables maquettes haute-fidélité (Figma ou Claude Design, comme utilisé pour le prototype V1) sera réalisée écran par écran au moment du développement de chaque module, afin de rester synchronisée avec l'évolution réelle du produit plutôt que figée en amont.

## 7. Livrables de ce document

- Système de design consolidé (couleurs, typographie, composants)
- Principes UX transversaux, incluant les considérations de sécurité (action sensible visuellement distincte)
- Wireframes texte des 7 écrans clés couvrant les 4 rôles (Employé, Technicien, Superviseur, Administrateur via CMDB)
- Liste des composants Shadcn UI prioritaires pour le développement frontend (document 07, section 4)
