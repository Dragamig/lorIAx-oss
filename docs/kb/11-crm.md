---
title: "CRM"
description: "Module CRM de LorIAx : activation par organisation, raccordement des bases Contacts, Dossiers et Interactions à leurs champs métier, désactivation sans perte de données."
---

## Ce que le module contient

Le module CRM ne stocke aucune donnée. Les contacts, dossiers et interactions sont des lignes de bases ordinaires, dans **Bases**. Le module garde seulement le raccordement : quelle base joue quel rôle, et quelle colonne correspond à quel champ métier. Une table `crm_connections` porte ce raccordement, une ligne par organisation.

Le module est disponible dans toutes les offres. Il se rend disponible sur l'instance par un interrupteur du super administrateur, puis s'active organisation par organisation.

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

## Ce qui n'est pas dans le module

Les automatismes d'exemple ne sont pas disponibles. Les écrans pipeline, À relancer, Dossiers et Contacts et la fiche dossier ne sont pas disponibles non plus. Les lignes se consultent et se modifient dans **Bases**.
