---
title: "Aide et prise en main"
description: "Se faire aider dans LorIAx : bouton d'aide ? et assistant d'aide, visite guidée (tuto) à la première connexion, relancer le tuto, espace démo Découverte LorIAx, badges, menu utilisateur et palette de commandes Ctrl+K."
---

## L'assistant d'aide (bouton ?)

L'assistant d'aide répond aux questions sur l'utilisation de LorIAx : fonctionnalités, menus, paramètres, prise en main. Il s'appuie uniquement sur la documentation produit de LorIAx et dit qu'il n'a pas l'information quand elle n'y figure pas.

1. En bas de la barre latérale, à droite du menu utilisateur, cliquez sur l'icône **?** (info-bulle **Aide**), entre la **Messagerie** et les notifications.
2. Le panneau **Assistant d'aide** s'ouvre à droite. Cliquez sur une suggestion (« Comment créer une base de données ? », « Comment partager un document ? ») ou tapez votre question dans le champ **Votre question...**, puis envoyez.
3. Fermez le panneau avec la croix **Fermer**, la touche Échap ou un clic en dehors.

### Remonter un problème

L'assistant d'aide ne propose pas de bouton de signalement et ne transmet rien : il répond seulement aux questions d'utilisation. Pour un dysfonctionnement, décrivez à votre administrateur ce que vous faisiez, ce que vous attendiez et ce qui s'est passé.

### Pourquoi je ne vois pas le bouton ?

Le bouton **?** n'apparaît que si les deux conditions sont réunies :

- l'assistant d'aide est activé par un administrateur : page **Réglages** de l'administration IA (`/admin/ai/settings`), section **Assistant d'aide**, interrupteur **Activer l'assistant d'aide**, puis **Enregistrer**. Il est activé par défaut ; désactivé, le bouton disparaît pour tous les utilisateurs ;
- au moins un fournisseur IA est configuré. Sinon, la page de réglages affiche l'avertissement **Aucune IA configurée** avec le lien **Configurer un fournisseur IA** (`/admin/ai/providers`).

### Assistant d'aide ou Assistant IA ?

- **Assistant d'aide** (bouton **?**) : répond sur le mode d'emploi de LorIAx, à partir de la documentation produit. Il ne lit pas vos documents.
- **Assistant IA** (entrée **Assistant IA** de la barre latérale, `/ai`) : chat sur vos propres contenus, qui cherche les passages pertinents dans les espaces auxquels vous avez accès (il consulte aussi la documentation produit). Voir la fiche « Assistant IA ».

## La visite guidée (tuto)

### Démarrage

À la première connexion, la visite guidée démarre seule. Elle crée un espace personnel de démonstration, **Découverte LorIAx** (icône 🎓), pour essayer sans toucher à vos vrais contenus.

Chaque étape met en avant un élément de l'écran, avec un compteur **Étape n/N** et les boutons :

- **Suivant** : passe à l'étape suivante (à la dernière étape, termine la visite) ;
- **Précédent** : revient en arrière ;
- **Passer** ou la croix **Fermer le tutoriel** : arrête la visite. Elle ne redémarre plus seule.

### Les étapes

1. **Bienvenue dans LorIAx !** : le bouton **Nouvel espace** de la barre latérale.
2. **Ton premier document** : un nouveau document de l'espace démo et le menu « / ».
3. **Ta première base** : la page **Bases** (`/bases`).
4. **Planifier une réunion** : le bouton **Événement** du calendrier (`/calendar`).
5. **Ton calendrier** : la vue semaine.
6. **Tes tâches** : la page **Mes tâches** (`/tasks`).
7. **Créer une présentation** : la page **Présentations** (`/presentations`). Étape retirée si le module Présentations est désactivé.
8. **L'assistant IA** : la page **Assistant IA** (`/ai`).
9. **La palette de commandes** : la palette s'ouvre automatiquement.
10. **Bravo, tu as fait le tour !** : le menu utilisateur, avec les boutons **Aller à mon vrai espace** et **Supprimer l'espace démo**.

### Reprendre ou relancer

- Visite commencée mais ni terminée ni passée : un bandeau « Continue ta prise en main » propose **Reprendre**. Sa croix le masque pour la session en cours.
- Relancer depuis le début, à tout moment : cliquez sur votre nom en bas de la barre latérale pour ouvrir le menu utilisateur, puis **Relancer le tuto**.

### L'espace démo

L'espace **Découverte LorIAx** sert d'entraînement : les documents, bases, présentations et partages créés dedans ne débloquent pas de badge. Pour le supprimer, utilisez **Supprimer l'espace démo** à la dernière étape de la visite.

## Les badges

Menu utilisateur > **Mes badges** ouvre la page **Mon profil** (`/settings/profile`), section **Mes badges**. Un badge débloqué est en couleur, un badge verrouillé est grisé.

| Badge | Comment le débloquer |
|---|---|
| Premier espace | Créer un espace |
| Premier document | Créer un document (hors espace démo) |
| Première base | Créer une base (hors espace démo) |
| Premier événement | Créer un événement dans le calendrier |
| Première visio | Créer une réunion visio |
| Premier partage, Première collaboration | Ajouter un membre à un espace (hors espace démo) |
| Première tâche suivie | Changer le statut d'une tâche |
| Première présentation | Créer une présentation (hors espace démo) |
| Première question à l'IA | Poser une question à l'assistant IA |
| Palette de commandes | Ouvrir la palette de commandes |
| Tuto terminé | Aller au bout de la visite guidée |
| Explorateur | Explorer les fonctions avancées |

## La palette de commandes (Ctrl+K)

Appuyez sur **Ctrl+K** (**Cmd+K** sur Mac) depuis n'importe quelle page. Le même raccourci, la touche Échap ou un clic en dehors la referment.

1. Tapez au moins deux caractères dans **Rechercher un document, une commande…** : le groupe **Documents** liste les documents trouvés avec leur espace. Si la Médiathèque est active, le groupe **Médias** liste aussi les médias trouvés.
2. Naviguez avec ↑ ↓, ouvrez avec Entrée.

Le groupe **Actions rapides** reste toujours affiché, quelle que soit la saisie :

- **Accueil** (`/`)
- **Recherche avancée** (`/search`)
- **Graphe de connaissances** (`/graph`)
- **Assistant IA** (`/ai`)
- **Nouveau document** (`/new`)
- **Paramètres** (`/settings`)
- **Ouvrir la médiathèque** et **Téléverser**, si la Médiathèque est active.

La palette ne cherche pas les espaces, les bases ni les événements : pour une recherche complète, utilisez **Recherche avancée**.
