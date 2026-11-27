---
title: "Tâches"
description: "Suivre ses tâches dans LorIAx : page Mes tâches, statuts Ouverte, En cours, Terminée, Annulée, échéances, assignation, notification « Tâche assignée », blocs Tâches de l'éditeur, tâches de fiche des bases, tâches du Gantt et des automatisations."
---

## Ouvrir la page Mes tâches

La page **Mes tâches** est dans la barre latérale (`/tasks`). Un compteur à droite du libellé indique le nombre de tâches **Ouverte** ou **En cours**. Le même nombre s'affiche en badge à côté du titre de la page.

La page liste :

- les tâches qui vous sont assignées ;
- les tâches que vous avez créées et qui ne sont assignées à personne.

Elle se met à jour toute seule toutes les 30 secondes. Sans tâche, elle affiche « Aucune tâche assignée pour l'instant. »

## Lire la liste

Les tâches sont regroupées par statut, dans cet ordre : **Ouverte**, **En cours**, **Terminée**, **Annulée**. Chaque groupe affiche son nombre de tâches. Un groupe vide est masqué. Dans un groupe, les tâches sont triées par échéance.

Chaque ligne affiche :

- le titre de la tâche ;
- un lien vers sa source : le document, **Calendrier** pour une tâche du Gantt, ou **Fiche** suivi du nom de la base pour une tâche de ligne ;
- l'échéance, si elle existe (« Échéance » suivie de la date) ;
- le statut, sous forme d'étiquette.

La page n'a ni filtre, ni recherche, ni autre vue que ce regroupement par statut.

## Changer le statut

Pour une tâche de fiche, du Gantt ou d'une automatisation :

1. Cliquez sur l'étiquette de statut de la tâche.
2. Choisissez le nouveau statut dans le menu : **Ouverte**, **En cours**, **Terminée** ou **Annulée**.

Seuls la personne assignée et l'auteur de la tâche peuvent la modifier.

Pour une tâche issue d'un document, le statut se change uniquement dans le document, qui reste la référence. Dans **Mes tâches**, son étiquette de statut n'ouvre pas de menu (info-bulle « Le statut se change dans le document ») et un bouton **Ouvrir le document** s'affiche à côté :

1. Cliquez sur **Ouvrir le document**.
2. Dans le bloc Tâches, cliquez sur l'icône de statut à gauche de la tâche.

Le nouveau statut apparaît dans **Mes tâches** environ 2 secondes après la modification du document (au plus tard au rafraîchissement automatique, toutes les 30 secondes). Le statut **Annulée** n'existe pas dans le bloc Tâches d'un document.

## Créer des tâches dans un document

1. Dans l'éditeur, tapez `/` puis choisissez **Tâches** (« Liste de tâches avec assignation et suivi »). La commande répond aussi à `/todo`, `/task` ou `/tache`. Le bouton **Checklist** de la barre d'outils insère le même bloc.
2. Écrivez le titre de la tâche. **Entrée** crée une nouvelle tâche, ouverte et non assignée.
3. Cliquez sur l'icône de statut, à gauche, pour passer de **Ouverte** à **En cours**, puis **Terminée**, puis de nouveau **Ouverte**. Les info-bulles indiquent **Marquer en cours**, **Marquer terminé** et **Rouvrir**. Une tâche terminée est barrée.

Chaque tâche du bloc est enregistrée environ 2 secondes après la dernière modification. Supprimer la ligne du document supprime la tâche.

Ne confondez pas avec **Cases à cocher** (« Checklist simple sans suivi ») : ces cases n'ont ni assignation ni statut, et n'apparaissent pas dans **Mes tâches**. Les autres blocs de l'éditeur sont décrits dans la fiche Documents et éditeur.

### Assigner une tâche de document

1. Cliquez sur l'icône à droite de la tâche (info-bulle **Assigner cette tâche**).
2. Dans **Assigner à…**, tapez un nom dans **Rechercher un membre…**.
3. Choisissez la personne. Son avatar remplace l'icône.

Pour retirer l'assignation, rouvrez le menu et cliquez sur **Retirer l'assignation**.

Une mention `@personne` dans le texte de la tâche l'assigne aussi, si aucune assignation n'est déjà choisie avec l'icône.

L'icône d'assignation n'apparaît que si vous pouvez modifier le document. Le bloc Tâches ne propose pas d'échéance.

## Tâches d'une fiche de base

L'onglet Tâches d'une fiche permet d'**Ajouter une tâche** avec titre, échéance et assigné, puis de la cocher. Le détail est dans la fiche Bases de données, section « Tâches d'une ligne ».

Dans **Mes tâches**, ces tâches portent la source **Fiche** et un lien vers la fiche. Si vous n'avez plus accès à l'espace de la base, la tâche reste listée avec la mention **Accès restreint**, sans lien. La personne assignée peut toujours changer son statut. Changer l'assigné ou l'échéance demande le droit d'édition sur l'espace.

## Tâches du Gantt

Dans la vue Gantt du calendrier :

1. Double-cliquez sur une tâche. La fenêtre **Paramétrer la tâche** s'ouvre.
2. Dans **Responsable**, cliquez sur **Assigner à…** et choisissez une personne.
3. Cliquez sur **Enregistrer**.

La tâche apparaît alors dans **Mes tâches** de cette personne, avec un lien **Calendrier**.

## Tâches créées automatiquement

- **Automatisations** : l'action **Créer une tâche** crée une tâche avec un titre, et en option un assigné, une échéance et un document.
- **CRM** : plusieurs automatismes d'exemple créent des tâches sur les dossiers, et l'écran **À relancer** affiche les tâches liées échues. Voir la fiche CRM.

## Notifications

Quand une tâche vous est assignée, vous recevez dans l'application la notification **Tâche assignée** : « Vous avez été assigné à : » suivi du titre. Cela vaut pour les tâches de document, de fiche, du Gantt et des automatisations.

## Questions fréquentes

**Où voir toutes mes tâches ?**
Dans **Mes tâches**, dans la barre latérale (`/tasks`).

**Comment marquer une tâche comme terminée ?**
Cliquez sur son étiquette de statut dans **Mes tâches** et choisissez **Terminée**. Pour une tâche de document, cliquez sur **Ouvrir le document**, puis sur l'icône de statut de la tâche dans le document jusqu'à **Terminée**.

**Pourquoi je ne peux pas changer le statut d'une tâche de document dans Mes tâches ?**
Le document est la référence : chaque enregistrement du document recalcule le statut de ses tâches. Un changement fait ailleurs serait perdu. Passez par **Ouvrir le document**.

**Ma case à cocher n'apparaît pas dans Mes tâches. Pourquoi ?**
Elle a sans doute été créée avec **Cases à cocher**, qui n'a pas de suivi. Utilisez la commande `/Tâches`.

**Comment ajouter une échéance ?**
Sur une tâche de fiche de base, dans le formulaire **Ajouter une tâche**, ou dans l'action **Créer une tâche** d'une automatisation. Le bloc Tâches de l'éditeur ne propose pas d'échéance.

**Puis-je filtrer ou trier mes tâches ?**
Non. La page groupe les tâches par statut et les trie par échéance.
