# 04 — Personas : AI Help Desk

## 1. Objectif

Ce document donne un visage concret aux rôles identifiés dans le BRD (document 02), afin d'ancrer les User Stories et les décisions de conception dans des besoins réels plutôt qu'abstraits.

---

## Persona 1 — Nathalie, employée administrative

**Rôle** : Agente administrative, service des finances
**Âge / profil** : 45 ans, à l'aise avec les outils bureautiques de base, peu de vocabulaire technique

**Objectifs**
- Résoudre son problème le plus vite possible pour reprendre son travail
- Ne pas avoir à attendre au téléphone ou à formuler une demande technique compliquée

**Frustrations actuelles**
- Doit expliquer son problème plusieurs fois (au premier répondant, puis au technicien réel)
- Ne sait jamais où en est sa demande une fois soumise
- Utilise un vocabulaire imprécis ("mon écran ne marche pas") qui complique le triage manuel

**Ce qu'elle attend d'AI Help Desk**
- Pouvoir décrire son problème avec ses propres mots, sans jargon
- Un diagnostic rapide qu'elle peut suivre elle-même, étape par étape
- Une confirmation claire si un ticket est créé, avec une idée du délai

**Citation représentative**
> *« Je veux juste que ça remarche, je ne sais même pas c'est quoi le problème exactement. »*

---

## Persona 2 — Marc-Antoine, technicien de support niveau 1

**Rôle** : Technicien informatique, support de premier niveau
**Âge / profil** : 27 ans, DEP en support informatique, 2 ans d'expérience, à l'aise avec les outils IT mais surchargé de volume

**Objectifs**
- Traiter un maximum de tickets sans sacrifier la qualité
- Éviter les tickets mal documentés qui demandent des allers-retours avec l'employé

**Frustrations actuelles**
- Reçoit des tickets vagues ("ça ne marche pas") sans contexte technique
- Passe du temps à chercher dans d'anciennes procédures ou tickets similaires
- Doit tout retaper manuellement pour des actions répétitives (réinitialisation de mot de passe, vérification d'appareil)

**Ce qu'il attend d'AI Help Desk**
- Des tickets déjà catégorisés, priorisés, et contextualisés (étapes déjà tentées visibles)
- Un copilote qui prépare les actions répétitives (ex. bouton "Approuver la réinitialisation" plutôt que de tout faire manuellement)
- Une recherche rapide dans les procédures et tickets passés similaires

**Citation représentative**
> *« Si je pouvais juste ne plus avoir à deviner c'est quoi le vrai problème avant de commencer à le régler, je sauverais un temps fou. »*

---

## Persona 3 — Sophie, superviseure IT

**Rôle** : Chef d'équipe support informatique
**Âge / profil** : 38 ans, 10 ans d'expérience, responsable d'une équipe de 6 techniciens

**Objectifs**
- Respecter les SLA de l'organisation
- Justifier les besoins en ressources auprès de la direction avec des données concrètes
- S'assurer qu'aucune action à risque n'est exécutée sans validation appropriée

**Frustrations actuelles**
- Peu de visibilité en temps réel sur la charge de travail de son équipe
- Doit compiler manuellement des statistiques pour ses rapports mensuels
- Inquiétude face aux outils d'automatisation qui pourraient agir sans supervision

**Ce qu'elle attend d'AI Help Desk**
- Un tableau de bord clair sur les délais, le volume et la charge par technicien
- Un mécanisme fiable de validation pour toute action sensible (déblocage, réinitialisation, permissions)
- Des rapports exportables sans compilation manuelle

**Citation représentative**
> *« Je suis ouverte à l'automatisation, mais je veux pouvoir dire non à une action avant qu'elle se produise, pas juste la découvrir après. »*

---

## Persona 4 — David, administrateur système / IT (rôle Administration)

**Rôle** : Administrateur de la plateforme AI Help Desk elle-même
**Âge / profil** : 34 ans, responsable de l'intégration avec Active Directory, Intune et la configuration des fournisseurs IA

**Objectifs**
- Configurer les intégrations (Microsoft Graph, fournisseur IA) sans avoir à toucher au code
- Garder un contrôle fin sur les permissions et les scopes accordés à l'application

**Frustrations actuelles**
- Les outils mal conçus demandent souvent des permissions excessives ("tout ou rien")
- Manque de journalisation claire en cas d'incident à investiguer

**Ce qu'il attend d'AI Help Desk**
- Une interface d'administration pour gérer les techniciens, les seuils d'escalade, les fournisseurs IA
- Des scopes Microsoft Graph configurés selon le principe du moindre privilège
- Des logs structurés et consultables en cas d'investigation

**Citation représentative**
> *« Je veux pouvoir dire exactement ce que l'application a le droit de faire, pas lui donner un accès total par simplicité. »*

---

## 2. Synthèse des besoins par persona

| Persona | Besoin principal | Pilier concerné |
|---|---|---|
| Nathalie (employée) | Simplicité, transparence | Pilier 1 — Support intelligent |
| Marc-Antoine (technicien) | Contexte, réduction du travail répétitif | Piliers 1, 2, 4 |
| Sophie (superviseure) | Visibilité, contrôle, données | Piliers 2, 5 |
| David (administrateur) | Configuration fine, sécurité | Piliers 4, transverse (Administration) |
