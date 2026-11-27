---
title: "Présentations"
description: "Créer et jouer des diaporamas dans LorIAx avec le module Présentations : présentation vierge ou modèle (présentation commerciale, compte rendu de réunion, formation, point d'avancement), éditeur de diapositives, diaporama plein écran, export PDF, bloc Présentation dans un document, modèles d'organisation, droits et limites."
---

## Ouvrir les présentations

L'entrée **Présentations** est dans la barre latérale, sous **Tableaux de bord** (`/presentations`). La palette de commandes (Ctrl+K) ne propose pas d'entrée pour cette page.

Le module Présentations est actif par défaut. Un administrateur de l'organisation peut le désactiver dans **Administration > Modules**. Module désactivé, l'entrée disparaît de la barre latérale, les pages des présentations n'existent plus et la commande `/Présentation` n'est plus proposée dans l'éditeur.

Une présentation appartient à un espace. La page liste les présentations d'un seul espace, de la plus récemment modifiée à la plus ancienne. Le sélecteur **Espace affiché**, à gauche de **Nouvelle présentation**, change d'espace. L'espace choisi est inscrit dans l'adresse de la page (`/presentations?spaceId=…`) et retenu pour votre prochaine visite. À la première visite, la page ouvre le premier de vos espaces par ordre alphabétique. Chaque carte indique le titre, le nombre de diapositives et la date de modification. Sous la liste, la section **Modèles** présente les modèles disponibles.

## Créer une présentation

1. Choisissez l'espace dans **Espace affiché**, puis cliquez sur **Nouvelle présentation**. La galerie de création s'ouvre.
2. Choisissez **Vierge** (une diapositive), ou un modèle.
3. La présentation s'ouvre dans l'éditeur.

Un modèle crée une copie : le modèle lui-même ne change pas. Quatre modèles sont fournis par LorIAx : **Présentation commerciale**, **Compte rendu de réunion**, **Formation** et **Point d'avancement**. Les modèles enregistrés par l'organisation s'ajoutent à la liste.

Depuis la section **Modèles**, un clic sur un modèle ouvre son aperçu, avec ses diapositives et **Utiliser ce modèle**. Les filtres **Tous**, **LorIAx** et **Organisation** trient la section.

## Éditer une présentation

L'éditeur occupe toute la page. Ses menus suivent la langue de l'application (en breton, ils restent en anglais).

- **Titre** : le champ en haut de l'éditeur. Il devient le titre de la présentation dans LorIAx.
- **Diapositives** : la liste est à gauche. **Nouvelle diapositive**, en bas de la liste, propose une disposition.
- **Contenu** : la barre d'outils insère **Texte**, **Forme**, **Image**, **Médias**, **Tableau**, **Graphique** et **Code**.
- **Annuler** et rétablir : boutons fléchés de la barre d'outils.
- **Raccourcis et astuces (?)** : aide de l'éditeur.

L'enregistrement est automatique, environ deux secondes après une modification. Ctrl+S enregistre tout de suite. L'état s'affiche au-dessus de l'éditeur : « Enregistrement », « Enregistré » ou « L'enregistrement a échoué. ». Si la présentation a été modifiée ailleurs entre-temps, un message demande de recharger la page : rien n'est écrasé.

**Retour à la liste** ramène à la liste des présentations de l'espace.

## Présenter

1. Dans l'éditeur, cliquez sur **Diaporama** : la présentation passe en plein écran.
2. La flèche à côté propose **Présenter dans cet onglet**, sans plein écran.
3. Échap termine le diaporama.

La vue présentateur n'est pas disponible dans LorIAx.

## Exporter en PDF

Le bouton **Exporter en PDF (imprimer)** de la barre d'outils ouvre l'impression du navigateur. Choisissez l'enregistrement en PDF comme destination dans la boîte d'impression pour obtenir le fichier.

## Présentation dans un document

1. Dans un document, tapez `/Présentation` (ou `/diaporama`).
2. Une présentation vierge est créée dans l'espace du document, et un bloc l'affiche à l'endroit du curseur.

Le bloc montre un aperçu et le nombre de diapositives. **Lire** lance le diaporama en plein écran. **Modifier** ouvre l'éditeur par-dessus le document ; **Fermer** le referme. **Supprimer le bloc** retire le bloc du document : la présentation reste dans la liste de l'espace. Un document en lecture seule ne propose que **Lire**.

## Supprimer une présentation

1. Sur la carte, cliquez sur l'icône de corbeille **Supprimer**.
2. Confirmez. La suppression est irréversible : il n'y a pas de corbeille pour les présentations.

## Modèles de l'organisation

Les modèles sont visibles par tous les membres de l'organisation. Leur gestion est réservée aux administrateurs de l'organisation :

- **Enregistrer comme modèle** : dans l'éditeur, ou dans le menu **Autres actions** d'une carte. Saisissez le **Nom du modèle** et une **Description**, puis **Enregistrer**. La présentation d'origine reste inchangée.
- **Modifier le modèle** : depuis l'aperçu. Un bandeau rappelle que vous modifiez un modèle ; **Terminer** enregistre et revient à la liste.
- **Retirer des modèles** : le modèle disparaît de la liste des membres. Les présentations déjà créées ne changent pas. **Rétablir** le remet dans la liste.
- **Réinitialiser** : remet un modèle fourni par LorIAx dans sa version d'origine. Indisponible pour les modèles de l'organisation.

Un membre qui ouvre un modèle voit un aperçu en lecture seule, avec **Créer dans l'espace** et **Utiliser ce modèle**.

## Droits

- Voir une présentation : accès à son espace.
- Créer, modifier, supprimer : droit d'édition sur l'espace. Un lecteur de l'espace ouvre la présentation en aperçu en lecture seule ; l'icône **Supprimer** ne lui est pas proposée et **Nouvelle présentation** est grisé (l'info-bulle l'explique).
- Modèles : lecture pour tous les membres, gestion pour les administrateurs de l'organisation.

## Limites

- Une présentation pèse au plus 5 Mo, images comprises.
- L'éditeur n'a pas accès à la médiathèque ni à Internet : les images s'ajoutent depuis l'appareil ou par collage. Pour réutiliser une image de la médiathèque, téléchargez-la depuis la **Médiathèque**, puis ajoutez-la depuis l'appareil.

## Questions fréquentes

**Je ne vois pas Présentations dans la barre latérale.** Le module est désactivé. Demandez à un administrateur de l'activer dans **Administration > Modules**.

**Je ne peux pas modifier une présentation.** Vous n'avez que la lecture sur son espace. Demandez le droit d'édition.

**Où est l'enregistrement ?** Il est automatique. Ctrl+S force un enregistrement immédiat.

**Comment obtenir un PDF ?** **Exporter en PDF (imprimer)**, puis l'enregistrement en PDF comme destination d'impression.

**J'ai supprimé le bloc d'un document : la présentation est-elle perdue ?** Non. Elle reste dans la liste **Présentations** de l'espace.
