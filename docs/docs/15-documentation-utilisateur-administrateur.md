# 15 — Documentation utilisateur et administrateur : AI Help Desk

*Ce document, contrairement aux précédents, s'adresse directement aux utilisateurs finaux du produit — pas à l'équipe de conception. Langage simple, orienté tâche.*

---

## Partie A — Guide de l'employé

### A.1 Se connecter
Cliquez sur **Se connecter avec Microsoft** et utilisez votre compte professionnel habituel. Aucun nouveau mot de passe à retenir.

### A.2 Signaler un problème
1. Depuis l'onglet **Nouvelle demande**, décrivez votre problème avec vos propres mots (ex. *« mon écran reste noir au démarrage »*)
2. Vous pouvez aussi cliquer directement sur une catégorie (Réseau, Matériel, Logiciel, Accès) si vous savez déjà de quoi il s'agit
3. Suivez les étapes proposées, en les cochant au fur et à mesure
4. Si le problème persiste après les étapes, cliquez **Le problème persiste** — un ticket sera créé automatiquement et assigné au bon technicien

### A.3 Suivre mes demandes
L'onglet **Historique** liste toutes vos demandes passées et actives, avec leur statut (Nouveau, En cours, Résolu, Escaladé). Cliquez sur une demande pour voir le détail complet.

### A.4 Évaluer une résolution
Une fois votre ticket marqué résolu, vous recevrez une invitation à indiquer si la solution vous convient — ça aide l'équipe IT à s'améliorer.

### A.5 Questions fréquentes
**Combien de temps avant qu'un technicien me réponde ?** Le délai estimé est affiché dès la création du ticket, selon la priorité déterminée automatiquement.

**Puis-je modifier mon ticket après l'avoir envoyé ?** Ajoutez un commentaire directement dans le détail du ticket ; le technicien assigné en sera notifié.

---

## Partie B — Guide du technicien

### B.1 Mon tableau de bord
L'onglet **Tableau technicien** affiche vos tickets actifs, triés par priorité. Chaque ticket montre le résumé, la catégorie, et les étapes déjà tentées par l'employé — vous n'avez pas à répéter le diagnostic de base.

### B.2 Traiter un ticket
- **Prendre en charge** : signale que vous commencez à travailler dessus
- **Résoudre** : marque le ticket comme terminé (ajoutez une note de résolution si possible, pour enrichir la base de connaissances)
- **Réassigner** : redirige le ticket vers un collègue si vous n'êtes pas disponible ou pas le bon spécialiste

### B.3 Utiliser la recherche documentaire
Dans l'onglet **Base de connaissances**, recherchez par mots-clés — le système retourne les procédures internes, tickets similaires déjà résolus, et guides constructeurs pertinents, chacun avec sa source affichée.

### B.4 Demander une automatisation
Si une action nécessite un script ou une action Active Directory/Intune (ex. réinitialiser un mot de passe), utilisez le bouton **Proposer une action** sur le ticket. L'action ne s'exécute **jamais automatiquement** si elle est sensible — elle attend une approbation (la vôtre ou celle d'un superviseur, selon la politique en place).

### B.5 Approuver une action sensible
Si vous êtes habilité à approuver, l'onglet **Approbations en attente** liste les actions proposées par vous-même ou par le système, avec leur justification. **Lisez toujours la justification avant d'approuver** — ne traitez pas cette étape comme une formalité.

---

## Partie C — Guide du superviseur

### C.1 Vue d'équipe
Le tableau de bord superviseur affiche le respect des SLA, le délai moyen de résolution, et la charge par technicien en temps réel.

### C.2 Gérer les SLA
Dans **Paramètres → SLA**, définissez les délais attendus par priorité (ex. Urgente : 1h). Un ticket qui dépasse son délai est automatiquement escaladé et signalé.

### C.3 Gérer les équipes
Associez les techniciens à des spécialités (Réseau, Matériel, Logiciel, Accès) dans **Paramètres → Équipes** — ça détermine l'assignation automatique des nouveaux tickets.

### C.4 Exporter des rapports
Depuis **Statistiques**, exportez un rapport CSV ou PDF pour vos présentations de gestion périodiques.

### C.5 Approuver des actions sensibles
Comme les techniciens habilités, vous pouvez approuver ou rejeter des actions proposées par l'IA ou par l'équipe — avec une vue sur l'ensemble des demandes, pas seulement les vôtres.

---

## Partie D — Guide de l'administrateur

### D.1 Gérer les utilisateurs et les rôles
Dans **Administration → Utilisateurs**, les comptes sont synchronisés automatiquement depuis Microsoft Entra ID. Assignez ou modifiez le rôle applicatif (employé, technicien, superviseur, administrateur) et les spécialités des techniciens.

### D.2 Configurer les intégrations
**Administration → Intégrations** permet de connecter :
- Microsoft Graph (utilisateurs, Outlook, Teams, OneDrive/SharePoint)
- Microsoft Intune (gestion des appareils)
- Le fournisseur IA actif (Claude, OpenAI, ou Azure OpenAI — changeable sans redéploiement)

> **Recommandation de sécurité** : accordez toujours le minimum de permissions nécessaires (principe du moindre privilège) lors de la configuration des scopes Microsoft Graph. Ne jamais utiliser un compte de service avec des permissions administratives globales par défaut.

### D.3 Gérer les scripts d'automatisation
Dans **Automatisation → Scripts**, chaque script ajouté est marqué **sensible par défaut**. Vous devez explicitement le reclasser comme non sensible si — et seulement si — il ne touche à aucune identité, permission ou donnée critique. En cas de doute, laissez-le sensible.

### D.4 Consulter les journaux d'audit
**Administration → Journaux d'audit** permet de rechercher toute action passée par acteur, type de ressource, ou période — incluant qui a approuvé quelle action sensible, quand, et pourquoi.

### D.5 Configurer les SLA et seuils d'escalade globaux
Les seuils par défaut peuvent être ajustés globalement ou par département, selon les besoins de l'organisation.

### D.6 Foire aux questions — administration

**Que se passe-t-il si le service IA (Claude) est indisponible ?**
Le système bascule automatiquement sur un mode de diagnostic simplifié par mots-clés — aucune interruption de service pour les employés, avec une précision réduite le temps que le service redevienne disponible.

**Puis-je changer de fournisseur IA sans interrompre le service ?**
Oui — la configuration du fournisseur actif se change depuis l'interface d'administration, sans redéploiement ni interruption.

**Comment savoir si une action sensible a été exécutée sans approbation ?**
Ce cas ne devrait jamais se produire — le système est conçu pour l'empêcher structurellement (voir document 06, RM-01). Une alerte de monitoring critique est déclenchée si une telle anomalie était détectée.

---

## Annexe — Glossaire rapide (rappel du document 03)

| Terme | Définition simple |
|---|---|
| Ticket | Une demande d'aide créée quand le diagnostic automatique ne suffit pas |
| SLA | Le délai maximum promis pour traiter un ticket selon sa priorité |
| CI (Configuration Item) | Tout élément géré (ordinateur, serveur, application, licence) suivi dans l'inventaire |
| RAG | La méthode qui permet à l'IA de chercher dans vos vrais documents avant de répondre |
| Action sensible | Toute action qui touche un compte, un mot de passe ou une permission — toujours soumise à approbation humaine |
