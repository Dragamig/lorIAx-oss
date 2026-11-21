---
title: "Organisation, espaces et rôles"
description: "Comprendre l'organisation dans LorIAx : appartenance multi-organisations, espaces personnels/équipe/organisation, membres, rôles globaux et rôles par espace, invitations."
---

## Organisations

Une organisation regroupe vos espaces, vos membres et vos contenus. Un même email peut appartenir à plusieurs organisations : vous pouvez basculer de l'une à l'autre selon le contexte.

## Espaces

Les espaces structurent les connaissances à l'intérieur d'une organisation :

- **Espace personnel** : vos notes privées, créé automatiquement, visible de vous seul par défaut.
- **Espace d'équipe** : partagé avec les membres d'un service.
- **Espace d'organisation** : visible par tous les membres de l'organisation, généralement pour la documentation officielle.

Chaque espace contient des dossiers (imbriqués, réorganisables par glisser-déposer) et des documents.

## Membres et invitations

- Un administrateur peut créer des espaces d'équipe et y ajouter ou retirer des membres.
- Les administrateurs peuvent créer des comptes utilisateurs directement (nom, email, mot de passe, rôle), avec envoi optionnel d'un email de bienvenue.
- Si l'organisation utilise un annuaire LDAP / Active Directory, les utilisateurs se connectent avec leurs identifiants habituels.

## Rôles globaux

Les rôles globaux déterminent ce qu'un utilisateur peut faire au niveau de l'organisation :

| Rôle | Ce qu'il permet |
|------|-----------------|
| **Super Admin** | Administration de l'**instance** entière : tout ce que fait un Admin, plus les réglages partagés par toutes les organisations (relais de messagerie, annuaire LDAP, visioconférence, moteur de transcription, fournisseurs d'IA de l'instance), les sauvegardes et restaurations, la licence. C'est le seul rôle qui agit au-delà de ses propres organisations. |
| **Admin** | Administration des **organisations dont il est membre**, et d'elles seules : utilisateurs, équipes, espaces, modules, salles de réunion, contenus. Il ne voit ni ne modifie les données ni les réglages d'une organisation à laquelle il n'appartient pas. |
| **Gestionnaire de salles** | Gestion des salles de réunion uniquement, sans accès aux autres onglets d'administration. |
| **Éditeur** | Création et modification de contenu, sans fonctions d'administration. |
| **Lecteur** | Consultation du contenu, sans modification. |

### Administration d'organisation et administration d'instance

Un Admin administre ses organisations, il n'en sort pas. Un Super Admin administre l'instance,
c'est-à-dire le serveur et tout ce qui est partagé par les organisations qu'il héberge.

Concrètement, un Admin qui ouvre certains écrans d'administration y trouve une explication plutôt
qu'un formulaire : réglages de messagerie, annuaire, transcription, sections Authentification et
LDAP des réglages système, sauvegardes, licence. Ces réglages valent pour toute l'instance, donc
les modifier depuis une organisation reviendrait à décider pour les autres. Les secrets déjà
enregistrés (mots de passe, clés) ne sont jamais réaffichés en clair, même à un Super Admin :
laisser le champ tel quel conserve la valeur en place.

## Rôles par espace

Indépendamment du rôle global, chaque espace peut attribuer ses propres droits :

- **Lecteur d'espace** : consulte le contenu de l'espace.
- **Éditeur d'espace** : crée et modifie le contenu de l'espace.
- **Administrateur d'espace** : gère l'espace et ses membres.

Ainsi, une personne peut être éditeur dans un espace et simple lecteur dans un autre.

## Classification des documents

En plus des rôles, chaque document porte un niveau de classification (Public, Interne, Confidentiel, Secret) qui affine qui peut le voir. Voir la fiche « Documents et éditeur ».

## Questions fréquentes

**Je fais partie de plusieurs organisations, est-ce possible ?**
Oui, un même email peut appartenir à plusieurs organisations et basculer entre elles.

**Quelle différence entre rôle global et rôle par espace ?**
Le rôle global agit au niveau de l'organisation. Le rôle par espace agit uniquement dans cet espace, indépendamment du rôle global.

**Je suis Admin, pourquoi certains écrans d'administration ne me proposent-ils rien à modifier ?**
Parce que ces réglages sont partagés par toutes les organisations de l'instance : messagerie, annuaire, visioconférence, transcription, sauvegardes, licence. Ils relèvent du Super Admin, qui administre le serveur. L'écran explique le motif à la place du formulaire.

**Je suis Admin de plusieurs organisations, est-ce que j'administre les autres ?**
Non. Vous administrez uniquement les organisations dont vous êtes réellement membre. Le rôle Admin ne donne aucun accès aux données ni aux réglages d'une organisation à laquelle vous n'appartenez pas.

**Qui peut créer des comptes utilisateurs ?**
Les administrateurs et super administrateurs, depuis l'Administration.

**Comment limiter qui voit un document ?**
Combinez le rôle d'espace et la classification du document (Confidentiel ou Secret pour restreindre).

**Qui gère les salles de réunion ?**
Les super admins, les admins et le rôle dédié « Gestionnaire de salles ».
