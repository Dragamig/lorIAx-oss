---
title: "Tableaux de bord"
description: "Créer, renommer et supprimer un tableau de bord (dashboard) dans LorIAx : choix de l'espace, widgets KPI (compteur), graphe en barres et camembert calculés sur les bases d'un espace, agrégats (nombre de lignes, somme, moyenne, minimum, maximum, % rempli, valeurs uniques), regroupement, filtres, taille et ordre des widgets, droits et limites."
---

## Ouvrir les tableaux de bord

L'entrée **Tableaux de bord** est dans la barre latérale, sous **Bases** (`/dashboards`). Elle est toujours visible : les tableaux de bord ne sont pas un module à activer. La palette de commandes (Ctrl+K) ne propose pas d'entrée pour cette page.

Un tableau de bord appartient à un espace. La page liste les tableaux de bord d'un seul espace, triés par nom. Le sélecteur **Espace affiché**, en haut à droite de la page, change d'espace. L'espace choisi est inscrit dans l'adresse de la page (`/dashboards?spaceId=…`) : un lien copié rouvre le même espace. Il est aussi retenu pour votre prochaine visite, comme dans **Bases**. À la première visite, la page ouvre le premier de vos espaces par ordre alphabétique. Sans aucun espace accessible, elle affiche « Aucun espace accessible. ».

À ne pas confondre avec :

- la vue **Tableau de bord** d'une base, qui ne porte que sur cette base (voir la fiche Bases) ;
- la page d'accueil, qui affiche vos favoris, modèles, événements et documents récents.

## Créer un tableau de bord

1. Ouvrez **Tableaux de bord** dans la barre latérale.
2. Choisissez l'espace dans **Espace affiché**.
3. Saisissez un nom dans le champ **Nom du tableau de bord**.
4. Cliquez sur **Nouveau**, ou appuyez sur Entrée.

Le tableau de bord s'ouvre aussitôt, vide, avec le message « Aucun widget. Ajoutez-en un. ». Un clic sur une carte de la liste rouvre un tableau de bord existant. **Tous les tableaux de bord**, en haut du tableau de bord, ramène à la liste de son espace.

## Renommer un tableau de bord

- Depuis la liste : sur la carte, ouvrez le menu **Actions du tableau de bord** (trois points), puis **Renommer le tableau de bord**.
- Depuis le tableau de bord : cliquez sur l'icône crayon **Renommer le tableau de bord**, à droite du titre.

Saisissez le nouveau nom, puis appuyez sur Entrée ou cliquez sur la coche **Enregistrer le nom**. Échap ou la croix **Annuler le renommage** referme le champ sans rien changer.

## Supprimer un tableau de bord

1. Depuis la liste, menu **Actions du tableau de bord** > **Supprimer le tableau de bord** ; ou, dans le tableau de bord, l'icône corbeille **Supprimer le tableau de bord**.
2. Confirmez dans la boîte de dialogue. **Annuler** referme la boîte sans rien supprimer.

La suppression est définitive et emporte tous les widgets du tableau de bord. Les bases sources ne sont pas touchées. Depuis le tableau de bord, vous revenez ensuite à la liste de son espace.

## Ajouter un widget

1. Dans le tableau de bord, cliquez sur **Ajouter un widget**. Un panneau de réglage s'ouvre.
2. Saisissez le **Titre du widget**.
3. Choisissez la base dans **— Base source —**. Seules les bases de l'espace du tableau de bord sont proposées.
4. Choisissez le type : **KPI (compteur)**, **Graphe barres** ou **Camembert**.
5. Choisissez le calcul (voir ci-dessous) et, si besoin, la colonne dans **— Colonne —**.
6. Pour un graphe ou un camembert, choisissez la colonne dans **— Grouper par —**.
7. Choisissez la taille : **Demi-largeur** ou **Pleine largeur**.
8. Ajoutez un filtre si besoin dans **Filtre (optionnel)**.
9. Cliquez sur **Enregistrer**, ou sur **Annuler** pour fermer sans rien créer.

**Enregistrer** reste grisé tant que le titre et la base source manquent, et, pour un graphe ou un camembert, tant que **— Grouper par —** n'est pas choisi.

Les widgets s'affichent sur deux colonnes, dans l'ordre choisi (ordre de création par défaut, nouveau widget en dernier). Un widget **Pleine largeur** occupe les deux colonnes.

## Types de widgets

- **KPI (compteur)** : un seul nombre en grand.
- **Graphe barres** : une barre par valeur de la colonne de regroupement.
- **Camembert** : une part par valeur de la colonne de regroupement.

Les widgets d'un même tableau de bord peuvent lire des bases différentes de l'espace.

## Calculs disponibles

- **Nombre de lignes** : compte les lignes. Aucune colonne à choisir.
- **Somme**, **Moyenne**, **Minimum**, **Maximum** : ne proposent que les colonnes nombre et formule. Les cellules vides ou non numériques sont ignorées.
- **% rempli** : part des lignes dont la cellule est remplie, de 0 à 100.
- **Valeurs uniques** : nombre de valeurs distinctes, cellules vides exclues.

Pour un graphe, le calcul s'applique à chaque groupe. Les lignes sans valeur forment le groupe « (vide) ». Une ligne qui porte plusieurs valeurs (sélection multiple, par exemple) compte dans chaque groupe. Un regroupement sur une colonne personne affiche le nom des personnes ; sur une colonne relation, le nom des lignes liées.

## Filtrer un widget

Le filtre apparaît une fois la base source choisie. Il utilise le même éditeur de conditions que les filtres des bases. Seules les lignes qui passent le filtre entrent dans le calcul. Changer de base source efface le filtre.

L'opérateur « est moi » n'est pas disponible dans un tableau de bord : le calcul se fait sans utilisateur courant.

## Modifier, déplacer ou supprimer un widget

Les icônes en haut à droite de chaque widget :

- **Déplacer avant** (flèche gauche) et **Déplacer après** (flèche droite) changent la place du widget dans la grille. L'ordre est enregistré aussitôt, pour tous les utilisateurs. La flèche est grisée pour le premier widget (avant) et pour le dernier (après).
- **Modifier** (crayon) rouvre le panneau de réglage avec les valeurs actuelles. **Enregistrer** applique les changements.
- **Supprimer** (corbeille) demande une confirmation, puis retire le widget. La suppression est définitive.

## Mise à jour des chiffres

Les chiffres sont calculés à l'ouverture du tableau de bord et après chaque ajout, modification ou suppression de widget. Ils ne se mettent pas à jour seuls : rechargez la page pour voir les dernières données des bases. Pendant le calcul, le widget affiche « Chargement… ». Sans ligne à afficher, un graphe indique « Aucune donnée ».

## Droits

- Voir un tableau de bord : accès à son espace.
- Créer, renommer ou supprimer un tableau de bord, ajouter, modifier, déplacer ou supprimer un widget : droit d'édition sur l'espace.
- Un lecteur de l'espace consulte les tableaux de bord sans bouton d'édition : la liste affiche « Lecture seule : votre droit sur cet espace permet de consulter ses tableaux de bord, pas de les modifier. », et le tableau de bord affiche « Lecture seule » à la place des boutons.
- Si une action échoue (droit retiré entre-temps, tableau de bord supprimé ailleurs, serveur injoignable), un message en bas de l'écran dit ce qui a échoué et pourquoi. Un déplacement refusé remet le widget à sa place.
- Si la base source d'un widget devient inaccessible, le widget affiche « Base source inaccessible ».

## Limites

- Trois types de widgets seulement : KPI, barres, camembert.
- Pas de glisser-déposer des widgets : l'ordre se règle avec les flèches **Déplacer avant** et **Déplacer après**.
- Pas de modification de la description d'un tableau de bord depuis l'interface.
- Pas d'export (image, PDF ou tableur) ni de lien de partage : l'accès suit les droits de l'espace.
- Supprimer une base supprime aussi les widgets qui la lisent.

## Questions fréquentes

**Je ne vois pas mon tableau de bord dans la liste.** La liste n'affiche qu'un espace à la fois. Choisissez son espace dans **Espace affiché**.

**Je ne vois ni « Nouveau » ni le menu des cartes.** Vous n'avez que la lecture sur cet espace. Demandez le droit d'édition à un administrateur de l'espace.

**Ma base n'apparaît pas dans « — Base source — ».** Seules les bases de l'espace du tableau de bord sont proposées.

**Pourquoi « — Colonne — » ne montre que quelques colonnes ?** Pour **Somme**, **Moyenne**, **Minimum** et **Maximum**, seules les colonnes nombre et formule sont proposées.

**Pourquoi le bouton Enregistrer est grisé ?** Il manque le titre, la base source, ou le regroupement d'un graphe.

**Mes chiffres ne bougent pas après une saisie dans la base.** Rechargez la page du tableau de bord.
