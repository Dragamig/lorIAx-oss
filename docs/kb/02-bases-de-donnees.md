---
title: "Bases de données"
description: "Créer et utiliser les bases (tables) de LorIAx : colonnes et types, vues (tableau, kanban, galerie, calendrier, formulaire, tableau de bord), filtres et tri, bases liées dans un document, automatisations et synchronisation externe."
---

## Les bases de données dans LorIAx

Une base est une table structurée, type Notion ou Airtable. Chaque ligne est un enregistrement, chaque colonne un champ typé. Les bases existent à deux endroits :

- **Dans un document** : insérez un bloc base via `/` (Nouvelle base ou Base existante).
- **Dans l'Espace Bases** (`/bases`) : une section dédiée pour gérer vos bases de façon autonome, avec une sidebar de groupes et de tables.

## Colonnes et types de champs

Une colonne peut prendre l'un des types suivants :

- Texte, Nombre
- Date, Heure
- Sélection (liste de choix)
- Case à cocher
- Relation (lien vers une autre base)
- Image
- Pièces jointes (plusieurs fichiers, comptées dans le quota de stockage de l'organisation)
- URL, E-mail
- Formule (calcul à partir d'autres colonnes)

### Relations

Créer une relation crée aussi la colonne inverse dans la base liée : une modification d'un côté met l'autre à jour, y compris à la suppression d'une ligne. La base cible ne peut plus être changée après la création. À la suppression d'une relation, l'application propose deux choix pour la colonne inverse.

### Formules

Les colonnes de type Formule permettent des calculs. Une **aide formules** assistée par IA est disponible dans l'Espace Bases : elle génère des formules conformes à l'évaluateur de LorIAx en s'appuyant sur les noms de vos colonnes.

## Les vues

Une même table peut s'afficher selon plusieurs vues, sous forme d'onglets :

- **Tableau (grid)** : la grille classique de lignes et colonnes.
- **Kanban** : cartes réparties en colonnes selon un champ de sélection ; disponible dans l'Espace Bases, avec déplacement des cartes, fiche en panneau latéral et création de ligne.
- **Galerie** : cartes visuelles, avec les mêmes réglages d'affichage que le Tableau.
- **Calendrier** : affichage mensuel ; vous choisissez la colonne de date et la colonne de titre.
- **Formulaire** : un formulaire de saisie publié à une adresse publique pour collecter des réponses depuis l'extérieur.
- **Tableau de bord** : widgets de synthèse (compteur, graphique, lignes récentes) avec calculs (count, somme, moyenne, min, max) et graphiques (barres, courbes, camembert).

## Totaux du kanban

Le menu **Totaux** de la vue Kanban calcule des montants par voie à partir d'une colonne de la base.

- **Colonne montant** : une colonne de type Nombre ou une formule numérique. Sans colonne choisie, aucun total n'est affiché.
- **Devise** : code à trois lettres (par exemple EUR), utilisé pour l'affichage des montants.
- **Voie close** : une voie cochée close est exclue des montants en cours du bandeau. La voie « Sans valeur » ne peut pas être close.
- **Poids** : entier de 0 à 100 par voie, saisissable quand le total pondéré est activé. Le poids d'une voie close est désactivé : il n'entre dans aucun montant pondéré.
- **Total pondéré** : somme des montants multipliés par le poids de leur voie.

Chaque voie affiche son total dans son en-tête. Le bandeau au-dessus du kanban indique le nombre de dossiers, le nombre de dossiers ouverts, le montant en cours et, si le total pondéré est activé, le montant pondéré. Une carte dont la cellule de montant est vide ou invalide est comptée « Non chiffré » et n'ajoute rien au total.

Si la colonne de montant est supprimée ou n'est plus de type Nombre ou formule numérique, les totaux sont inactifs et le menu l'indique. Lorsque la colonne de regroupement accepte plusieurs valeurs, une carte compte dans chacune de ses voies.

Le kanban applique les filtres et le tri enregistrés dans la vue : les totaux portent sur les cartes affichées.

## Vues partagées et personnelles

Une vue a une visibilité : **Partagée** (visible par toute l'organisation) ou **Personnelle** (visible par son auteur seul). Dans le formulaire de création d'une vue, la visibilité par défaut est Personnelle. Les vues apparaissent dans la barre des vues sous deux groupes, Partagées et Personnelles.

- Seul l'auteur d'une vue peut changer sa visibilité.
- Une vue personnelle ne peut être ni la vue par défaut ni publique.
- Une base garde au moins une vue partagée : la dernière vue partagée ne peut être ni supprimée ni passée en personnelle.
- La suppression d'une vue propose « Annuler » ; l'annulation rétablit la vue avec la même visibilité.
- Une vue personnelle d'un autre utilisateur est introuvable, y compris pour un administrateur d'espace.
- Quand un compte est supprimé, ses vues personnelles sont supprimées et ses vues partagées sont conservées.

### Filtres relatifs à l'utilisateur et à la date

- **est moi** (colonne Personne) : garde les lignes où l'utilisateur connecté figure dans la cellule.
- **ce trimestre** (colonne Date) : garde les lignes dont la date tombe dans le trimestre civil en cours, selon le fuseau horaire de l'utilisateur.

Une automatisation refuse un filtre « est moi » avec un message explicite, car aucun utilisateur connecté n'y est défini. Dans l'export, « est moi » désigne l'utilisateur qui exporte, et le fuseau horaire est celui du paramètre `tz` (Europe/Paris par défaut).

## Fiche d'une ligne

La fiche d'une ligne s'ouvre dans un panneau latéral depuis les vues Tableau, Kanban, Galerie et Calendrier. Dans le tableau : clic sur une ligne, icône « Ouvrir la fiche » ou Alt+Entrée. Dans le kanban : clic sur le corps d'une carte.

- **Plein écran** : le bouton de l'en-tête ou Alt+Entrée bascule entre le panneau latéral et le plein écran. Sur un écran de moins de 900 px, le plein écran est imposé.
- **Précédent et suivant** : les boutons ou Alt+Flèche gauche / droite parcourent les lignes dans l'ordre de la vue d'où la fiche a été ouverte. Aux extrémités de la liste, le bouton est désactivé et son info-bulle en donne la raison.
- **Fermer** : Échap ferme la fiche. Pendant l'édition d'un champ, Échap rétablit d'abord la valeur du champ ; un second Échap ferme la fiche.
- **Lien direct** : l'adresse de la page porte `?row=` suivi de l'identifiant de la ligne. Ouvrir ce lien rouvre la fiche. Si la ligne n'existe pas ou n'est pas accessible, la fiche affiche « Fiche introuvable ».
- **Annuler une modification** : chaque champ modifié affiche un message « Annuler » qui rétablit la valeur précédente. Un message d'erreur apparaît si l'écriture ou l'annulation échoue.

## Historique d'une ligne

L'onglet Activité de la fiche liste, du plus récent au plus ancien, qui a fait quoi et quand : création, modification de champs (valeur avant et après), suppression et restauration de la ligne.

- **Regroupement** : les modifications faites ensemble (une même action, un import, un automatisme) forment une seule entrée, dépliable pour voir chaque champ.
- **Origine** : sous le nom de l'auteur, l'entrée indique la source quand elle n'est pas une saisie dans l'interface : Formulaire public, Synchronisation, Relation synchronisée, Restauration, Import, Système, ou Automatisme suivi de son nom. Un import est journalisé sans détail par champ.
- **Conservation** : l'historique d'une ligne supprimée est conservé 30 jours, puis purgé. Annuler une suppression rend l'historique antérieur.
- **Effacement** : un administrateur ou propriétaire de l'organisation efface l'historique d'une ligne avec le bouton corbeille de l'onglet, après confirmation. L'effacement est définitif.

## Commentaires d'une ligne

L'onglet Activité de la fiche porte une zone de commentaire en tête. Les commentaires apparaissent dans la chronologie avec les modifications de la ligne.

- **Publier** : Ctrl+Entrée ou le bouton Commenter. Un commentaire compte 5 000 caractères au plus.
- **Mentionner** : taper `@` ouvre la liste des membres de l'espace qui peuvent voir la base. La recherche porte sur le nom, pas sur l'adresse e-mail. La liste se charge par pages de 50. Une personne mentionnée reçoit une notification dans l'application, qui ouvre la fiche. Aucun e-mail n'est envoyé.
- **Modifier** : seul l'auteur modifie son commentaire.
- **Supprimer** : l'auteur ou un administrateur de l'espace supprime un commentaire. Le message « Annuler » le rétablit.
- **Conservation** : les commentaires d'une ligne supprimée sont conservés 30 jours, puis purgés. L'effacement par un administrateur d'organisation les supprime aussi, avec les tâches et les notifications de la ligne.

## Tâches d'une ligne

L'onglet Tâches de la fiche liste les tâches liées à la ligne. Le badge de l'onglet indique le nombre de tâches ouvertes.

- **Ajouter** : bouton « Ajouter une tâche », avec titre, échéance facultative et assigné. Aucune échéance n'est posée par défaut. L'assigné doit pouvoir voir la base ; il reçoit une notification dans l'application.
- **Statut** : la case coche ou décoche la tâche. La chronologie de l'onglet Activité affiche « a créé la tâche », « a terminé la tâche » et « a rouvert la tâche ».
- **Mes tâches** : une tâche de ligne apparaît dans la page Tâches avec la source Fiche et un lien vers la fiche. Quand l'accès à l'espace est retiré, la tâche reste visible avec la mention « Accès restreint », sans lien.
- **Écran étroit** : sous 900 px, l'onglet Activité s'affiche sous les champs de la fiche.

## Sélection multiple et raccourcis

Dans la vue Tableau, vous pouvez agir sur plusieurs lignes à la fois.

- **Cases à cocher** : cochez les lignes voulues. **Maj+clic** sélectionne une plage, **Ctrl+clic** ajoute ou retire une ligne (Cmd+clic sur Mac). Ces clics fonctionnent aussi sur une cellule.
- **Ctrl+A** : sélectionne toutes les lignes.
- **Suppr** (ou Retour arrière) : supprime les lignes sélectionnées.
- **Ctrl+D** : duplique les lignes sélectionnées.
- **Alt+Flèche haut / bas** : déplace la ligne d'un cran.
- **Échap** : désélectionne.
- **Glisser-déposer** : saisissez la poignée d'une ligne pour la déplacer ; si plusieurs lignes sont sélectionnées, elles se déplacent ensemble. Le déplacement est indisponible quand la vue est triée.
- **Annuler** : après une suppression, une duplication ou un déplacement, un message propose « Annuler » pour rétablir les lignes.

## Filtres et tri

- Filtrez les enregistrements selon des conditions sur les colonnes.
- Triez selon une ou plusieurs colonnes.
- Dans une **base liée (lecture seule)** insérée dans un document, le tri et les filtres sont propres au document : ils sont stockés dans le bloc et ne modifient ni la base source ni ses vues.

## Bloc base lié dans un document

Pour réutiliser une base sans la dupliquer :

- Insérez « Base liée (lecture seule) » via `/`.
- La base s'affiche en lecture seule dans le document.
- Vous appliquez vos propres tri et filtres, sans toucher à la base d'origine.

## Automatisations des bases

Dans l'Espace Bases, vous pouvez automatiser des actions :

- **Déclencheurs** : à la création d'une ligne, à sa mise à jour, à sa suppression, ou selon une planification (cron).
- **Actions** : appeler un webhook, notifier un utilisateur, créer une ligne, mettre à jour une ligne.

Les automatisations sont encadrées par des quotas pour éviter les abus.

### Valeurs, base cible et correspondance

- **Jetons de date** : `{{today}}` (date du jour), `{{today+7}}` (date du jour décalée de 7 jours) et `{{now}}` (date et heure courantes) s'utilisent dans les champs d'une action. Une valeur est convertie selon le type de la colonne visée.
- **Base cible** : « Créer une ligne » et « Mettre à jour une ligne » peuvent écrire dans une autre base de votre organisation, à condition que vous y ayez accès.
- **Correspondance** : avec un critère de correspondance, l'action met à jour la ligne trouvée au lieu d'en créer une. L'action « Trouver une ligne » rend ses valeurs disponibles aux étapes suivantes.
- **Doublons** : une ligne identique à une ligne existante est ignorée. Si la ligne existante est incomplète, seules ses cases vides sont remplies, sans écraser les valeurs présentes. L'étape indique son résultat : créée, complétée, ignorée ou mise à jour.

### Brancher Tally

Un formulaire Tally peut alimenter une base par un déclencheur de webhook entrant.

- **Automatique** : enregistrez votre clé d'API Tally dans le panneau Tally du builder, choisissez le formulaire, puis cliquez sur « Brancher Tally ». LorIAx crée le webhook dans Tally avec l'en-tête secret. La clé est chiffrée et ne s'affiche plus ensuite.
- **Manuel** : copiez l'adresse du webhook et le secret de l'automatisme dans les réglages d'intégration du formulaire Tally.

### Importer les réponses déjà reçues

Le panneau Tally liste les formulaires et le nombre de réponses. Lancez d'abord une simulation, qui n'écrit rien, puis l'import réel, qui s'exécute en tâche de fond. Le détail de chaque réponse et sa trace restent consultables 30 jours. Une réponse déjà traitée, par import ou par webhook, n'est jamais rejouée.

### Tester et consulter l'historique

- Le bouton de test exécute le scénario, ou une seule étape, en simulation : rien n'est écrit ni envoyé. Un test réel se choisit explicitement.
- L'inspecteur montre les entrées et la sortie de chaque étape.
- L'historique garde le détail de chaque exécution et permet de la rejouer ; le rejeu remplace l'entrée d'origine. Si une étape est configurée pour continuer en cas d'erreur, l'exécution peut se terminer en statut « partiel ».

## Import, export et synchronisation

- **Tableur** : un classeur s'exporte en .xlsx depuis son document.
- **Export** : CSV et XLSX (Excel).
- **Synchronisation externe** : connexion avec Airtable et Notion, avec correspondance des types de champs.

## Création de base par l'IA

L'Espace Bases propose une création de base assistée par IA : décrivez ce que vous voulez, l'IA propose une structure que vous pouvez relire puis appliquer. Cette fonction nécessite qu'un fournisseur IA soit configuré sur l'instance.

## Questions fréquentes

**Quelle différence entre une base dans un document et l'Espace Bases ?**
Le bloc base dans un document est pratique pour intégrer une table à votre contenu. L'Espace Bases (`/bases`) est une section dédiée pour gérer des bases plus complètes avec plusieurs vues.

**Comment afficher mes données en kanban ou en calendrier ?**
Ajoutez une vue Kanban ou Calendrier via les onglets de vues de la table, puis choisissez la colonne de regroupement ou de date.

**Comment collecter des réponses depuis l'extérieur ?**
Créez une vue Formulaire et partagez son adresse publique.

**Puis-je réutiliser une base dans plusieurs documents sans la copier ?**
Oui, avec le bloc « Base liée (lecture seule) ». Chaque document garde ses propres tri et filtres.

**Comment exporter mes données ?**
Depuis la base, exportez en CSV ou XLSX.
