---
title: "CRM"
description: "Module CRM de LorIAx : activation par organisation, raccordement des bases Contacts, Dossiers et Interactions, écrans Pipeline, À relancer, Dossiers et Contacts, fiche dossier, fiche contact avec fil d'activité, menu et badge des relances."
---

## Ce que le module contient

Le module CRM ne stocke aucune donnée. Les contacts, dossiers et interactions sont des lignes de bases ordinaires, dans **Bases**. Le module garde seulement le raccordement : quelle base joue quel rôle, et quelle colonne correspond à quel champ métier. Une table `crm_connections` porte ce raccordement, une ligne par organisation.

Le module se rend disponible sur l'instance par un interrupteur du super administrateur, puis s'active organisation par organisation.

## Activer et désactiver

L'activation et la désactivation se font depuis **Administration > Modules**, sur la carte du module CRM. Elles sont réservées à l'administrateur de l'organisation.

- **Activer** : la fenêtre d'activation propose, pour chacun des rôles Contacts, Dossiers et Interactions, trois modes. **Raccorder** relie une base existante sans la modifier. **Compléter** ajoute à une base presque compatible les colonnes métier manquantes ; les colonnes existantes ne sont ni modifiées ni retypées, et une colonne de même nom mais de mauvais type reste en place, une colonne « Nom (type) » est ajoutée à côté. **Créer** produit une base avec tous les champs du rôle, dans la langue de l'utilisateur, et pose les relations entre Dossiers et Contacts, et entre Interactions et Dossiers. Une base Dossiers créée reçoit les vues Pipeline, Relances, Tous, Mes dossiers et Gagnés ce trimestre.
- **Organisation et espace** : le sélecteur d'organisation liste les organisations dont l'utilisateur est administrateur du CRM ; en choisir une ouvre cette organisation. Les bases créées vont dans un espace « CRM » créé pour l'occasion, ou dans un espace modifiable existant.
- **Nom déjà pris** : si une base porte déjà le nom du modèle dans l'espace choisi, la tuile le signale ; raccorder cette base ou choisir un autre espace.
- **Annuler** : le toast qui suit l'activation désactive le module et conserve les bases créées.
- **Désactiver** : le raccordement est conservé, les bases et leurs lignes restent intactes. Réactiver rétablit le raccordement tel qu'il était : choisir la même base pour un rôle ne modifie pas ses colonnes associées.

L'entrée **CRM** du menu de gauche apparaît quand le module est actif. Le badge **Non raccordé** signale qu'aucune base n'est encore raccordée.

## Raccordement

L'écran **Raccordement** s'ouvre depuis `/crm` ou `/crm/raccordement`. Il associe trois rôles à des bases de l'organisation :

- **Contacts** : nom, email, téléphone, structure.
- **Dossiers** : titre, statut, montant, relance, responsable, contact, clôture.
- **Interactions** : date, type, dossier, intitulé, compte rendu, pièces.

Cela fait 17 champs métier. Les champs obligatoires sont le nom (Contacts), le titre, le statut et le contact (Dossiers), la date, le type et le dossier (Interactions).

### Association automatique

À la sélection d'une base, chaque champ est associé à la colonne dont le nom correspond. La comparaison ignore la casse et les accents : « Téléphone » correspond à `telephone`. Une association se modifie champ par champ, et un champ facultatif peut rester vide.

### Validation par type de colonne

Chaque champ attend un type de colonne : par exemple un champ select pour le statut, une relation pour le contact, une date pour la relance. Une colonne d'un autre type reçoit l'état **Incompatible**, avec le type attendu et le type trouvé. Le raccordement ne s'enregistre pas tant qu'un champ obligatoire est manquant ou incompatible.

Une base ne peut servir qu'un seul rôle. Elle doit être lisible et modifiable par l'utilisateur, ni archivée ni en corbeille.

## Pipeline

L'écran **Pipeline** s'ouvre depuis l'entrée **CRM** du menu de gauche, à l'adresse `/crm`. Il affiche un tableau par statut : une colonne par voie, avec le nombre de dossiers et le montant de la voie, dans la devise de l'organisation. Une bannière indique la base source (« Source : base, espace »).

- **Mes dossiers** : filtre actif à l'ouverture. Il ne garde que les dossiers dont le **Responsable** est l'utilisateur connecté. Le bouton est désactivé quand le champ Responsable n'est pas raccordé.
- **En retard** : garde les dossiers dont la date de **Prochaine relance** est dépassée.
- **Responsable** : filtre sur une personne précise.
- **Total pondéré** : affiche le total de chaque voie pondéré par sa probabilité. Le bouton est désactivé quand aucun montant n'est raccordé.
- **Modifier les voies** : ouvre la base Dossiers dans **Bases**, où se règlent les voies, les poids et les voies closes.

Un dossier change de statut de deux façons : par le menu **Changer le statut** de la carte, ou par glisser-déposer vers une autre voie. Le déplacement écrit le statut dans la ligne de la base Dossiers. Un toast confirme l'action et propose **Annuler**. En lecture seule (sans droit d'édition sur la base Dossiers), le déplacement est indisponible.

## À relancer

L'écran **À relancer** (`/crm/relances`) liste les dossiers ouverts qui portent une date de **Prochaine relance**, en trois groupes : **En retard**, **Aujourd'hui** et **Cette semaine** (les 7 jours qui suivent). Les tâches liées aux dossiers et échues dans cet horizon apparaissent dans le groupe **Tâches liées**. Chaque ligne affiche la relance, le contact et la dernière interaction.

Le filtre **Mes dossiers** est actif à l'ouverture : les relances affichées sont celles des dossiers dont le Responsable est l'utilisateur connecté. Le bouton **Tous les dossiers** ouvre la liste complète.

Actions de chaque ligne :

- **Faite** : marque la relance comme faite. Le dossier quitte la liste.
- **Reporter** : propose **+1 jour**, **+1 semaine** ou **Date précise** (aujourd'hui ou plus tard).
- **Interaction** : consigne une interaction (type et intitulé) sur le dossier sans quitter l'écran.
- **Ouvrir** : ouvre la fiche du dossier.

Chaque action produit un toast avec **Annuler**.

## Dossiers et vues enregistrées

L'écran **Dossiers** (`/crm/dossiers`) affiche les dossiers en tableau : Dossier, Contact, Statut, Montant, Responsable, Relance, Clôture. Le pied de tableau donne le nombre de dossiers et le montant cumulé. Les filtres sont la recherche, le statut, le responsable (avec **Mes dossiers**, actif à l'ouverture) et **En retard**.

Les onglets du haut sont les vues enregistrées. Ce sont les vues réelles de la base Dossiers : une vue créée dans **Bases** apparaît dans l'écran, et une vue enregistrée depuis l'écran apparaît dans **Bases**. **Enregistrer la vue** demande un nom et une portée, **Moi seul** ou **Toute l'équipe**. Les vues partagées sont visibles de toute l'organisation, les vues personnelles de leur auteur seulement. Enregistrer ou supprimer une vue demande le droit d'édition sur la base Dossiers. Un filtre d'une vue qui porte sur une colonne absente ou sur une condition non gérée par l'écran est ignoré, et l'écran le signale.

Quand l'écran est ouvert depuis **Voir les dossiers** d'un contact, un filtre **Contact** est posé et **Mes dossiers** n'est pas appliqué. **Retirer le contact** supprime ce filtre.

## Contacts

L'écran **Contacts** (`/crm/contacts`) liste les contacts avec leur marque, le nombre de **Dossiers ouverts**, le **Montant cumulé** de ces dossiers dans la devise de l'organisation et la **Dernière interaction**. Une recherche filtre la liste.

- **Voir les dossiers** : ouvre l'écran Dossiers filtré sur le contact.
- **Ouvrir dans Bases** : ouvre la ligne dans la base Contacts.

## Fiche contact

Un clic sur une ligne de l'écran **Contacts** (menu **CRM**, **Contacts**) ouvre la fiche du contact, le panneau de ligne de la base Contacts. Le panneau contient une section **Activité**, identique à celle de la fiche dossier : interactions, mails et tâches liés au contact, avec les filtres **Tout**, **Interactions**, **Mails** et **Tâches**, l'aperçu dépliable des mails, **Annuler l'envoi** et **Réessayer**. La section n'a pas de bouton **Ajouter** : les interactions se créent depuis la fiche d'un dossier. **Ouvrir dans Bases** ouvre la ligne dans la base Contacts.

## Fiche dossier

La fiche d'un dossier est le panneau de ligne de **Bases**, ouvert depuis une carte du Pipeline ou une ligne des écrans À relancer et Dossiers. Le panneau ajoute des sections CRM au-dessus des champs génériques. Ouvert depuis **Bases** directement, le panneau reste celui de la base, sans section CRM :

- **Prochaine relance** : **Faite**, **Planifier une relance** avec les raccourcis Demain, Dans 3 jours, Dans 1 semaine, Dans 2 semaines, et une **Date précise**.
- **Contact lié** : coordonnées du contact, **Ouvrir** la fiche du contact, **Copier l'e-mail**, **Changer de contact**.
- **Activité** : le fil des interactions, des mails et des tâches liés au dossier, du plus récent au plus ancien. Le bouton **Filtrer** propose **Tout**, **Interactions**, **Mails** et **Tâches**. Sans élément, la section affiche « Aucune activité » ; un filtre sans résultat affiche « Aucun élément de ce type ». Si le chargement échoue, le bouton **Réessayer** relance la lecture.
- **Ajouter** une interaction : bouton de la section Activité (type, intitulé, date et commentaire). Il est désactivé en lecture seule et quand le raccordement des Interactions est incomplet.

### Cartes du fil d'activité

- **Interaction** : type, intitulé et date.
- **Tâche** : intitulé et échéance. **Terminer** marque la tâche comme terminée, **Rouvrir** la rétablit.
- **Mail** : objet, état et date. Le bouton de l'objet déplie ou replie un aperçu : objet, destinataires (À, Cc) et début du message.

Un mail envoyé apparaît deux fois dans le fil : la carte du mail et l'interaction que l'envoi a créée. Les mails annulés ne sont pas affichés. Chaque utilisateur ne voit que ses propres mails, pas ceux de ses collègues ; les interactions et les tâches restent visibles de tous ceux qui lisent les bases.

États d'un mail, affichés par un badge :

- **Programmé** : le mail attend son heure d'envoi. Le bouton **Annuler l'envoi** l'annule ; le mail ne part pas.
- **Envoi en cours** : l'envoi est en cours. L'annulation n'est plus possible.
- **Envoyé** : le mail est parti.
- **Échec** : le badge est accompagné du motif. Le bouton **Réessayer** relance l'envoi, sauf quand le résultat est incertain (voir Mailing).

Un mail réessayé repasse en **Programmé** et part au prochain passage de la file d'envoi. Le fil n'a pas de lien « Ouvrir dans Mails » : les mails se rédigent et se consultent par l'onglet **Mails** de la fiche.

Les sections sont en lecture seule pour un utilisateur sans droit d'édition sur la base. Quand un champ nécessaire n'est pas raccordé, la fiche affiche un avis en tête, et la section **Prochaine relance** est absente sans le champ Prochaine relance.

## Champ non raccordé ou invalide

Quand un champ exigé par un écran n'est pas raccordé ou n'est plus valide, l'écran affiche un avis qui nomme le champ, avec un lien vers **Raccordement** pour un administrateur. Au Pipeline, sans champ Statut valide, les dossiers ne se déplacent plus et aucune écriture n'est envoyée.

## Menu et badge

L'entrée **CRM** du menu de gauche se déplie (**déplier** et **replier**) en quatre entrées : **Pipeline**, **À relancer**, **Dossiers** et **Contacts**. **Raccordement** reste à `/crm/raccordement` et reste réservé à l'administrateur de l'organisation. Le badge **Non raccordé** s'affiche tant qu'une base manque.

Le badge numérique d'**À relancer** compte les relances en retard et du jour des dossiers dont le Responsable est l'utilisateur connecté. Il est plafonné à « 99+ » et masqué à zéro. Sans champ Responsable ou Prochaine relance raccordé, il vaut zéro.

## Automatismes d'exemple

À l'activation, six automatismes d'exemple sont créés dans la base Dossiers, tous **désactivés** : aucun ne s'exécute sans action de l'administrateur.

- **Devis envoyé : relance à 7 jours** : fixe la prochaine relance, crée une tâche et consigne une interaction.
- **En attente client : relance à 5 jours** : fixe la prochaine relance et crée une tâche.
- **Gagnée : clôture et trace** : renseigne la clôture et consigne une interaction.
- **Perdue ou sans suite : clôture** : renseigne la clôture et crée une tâche pour noter le motif.
- **Relances du jour (8 h)** : envoie chaque matin un rappel pour les relances du jour.
- **Réception Tally** : crée un dossier et un contact à chaque réponse à un formulaire Tally.

La carte de récapitulatif de l'écran Raccordement indique le nombre d'automatismes créés et propose **Voir dans Automatisations**. Pour en utiliser un, ouvrir **Automatisations**, vérifier ses réglages puis activer l'interrupteur.

- **Jamais recréés** : un automatisme supprimé ou renommé n'est pas recréé à la réactivation du module, et un automatisme désactivé reste désactivé.
- **Raccordement incomplet** : si un rôle ou une colonne nécessaire manque, l'exemple concerné est ignoré et listé dans le récapitulatif.
- **Options de Statut** : une option de Statut absente est ajoutée une fois à la colonne, et le récapitulatif la signale.

### Réception Tally

L'automatisme **Réception Tally** a sa propre boîte dans Automatisations.

1. Copier l'adresse du webhook et le secret masqué de la boîte.
2. Dans Tally, ouvrir les réglages d'intégration du formulaire (Webhooks), coller l'adresse, puis ajouter un en-tête HTTP nommé `X-Webhook-Secret` dont la valeur est le secret. Le champ « Signing secret » de Tally n'est pas utilisé.
3. Envoyer une réponse de test depuis Tally. Un automatisme désactivé enregistre cette réponse sans rien exécuter ni la traiter : l'import Tally permet de rattraper les réponses reçues pendant ce temps.
4. Choisir le formulaire dans la boîte.
5. Vérifier la correspondance des champs : nom, email et titre. Elle remplace la détection automatique par type. Le titre du dossier prend par défaut le nom du contact.
6. Activer l'interrupteur, grisé tant qu'aucun formulaire n'est choisi.

## Ce qui n'est pas dans le module

Le module n'a aucune donnée propre : ses lignes vivent dans **Bases**. Les écrans lisent et écrivent les bases raccordées, avec les droits de l'utilisateur sur chaque base, et une modification faite dans **Bases** apparaît dans les écrans.

L'ajout de pièces jointes à une interaction n'est pas disponible depuis le module.
