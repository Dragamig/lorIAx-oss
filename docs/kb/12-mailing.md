---
title: "Mailing"
description: "Envoi de mails depuis les fiches du CRM : boîte mail personnelle, onglet Mails, tiroir de rédaction, annulation, limite d'envoi et trace automatique dans les Interactions."
---

## Ce que fait le Mailing

Le Mailing envoie des mails depuis la fiche d'un contact ou d'un dossier du CRM, avec la boîte mail de l'utilisateur. Chaque mail envoyé est tracé dans la base Interactions. La relève des mails reçus et le rattachement des réponses ne sont pas disponibles.

Le Mailing demande un CRM activé et raccordé. Sans boîte mail configurée, le bouton **Écrire** est désactivé et renvoie vers les réglages.

## Activer l'envoi de mails depuis LorIAx

Trois étapes, dans cet ordre :

1. **Activer le CRM** (administrateur de l'organisation) : **Administration > Modules**, carte du module CRM, puis raccorder ou créer les bases Contacts, Dossiers et Interactions.
2. **Configurer sa boîte mail** (chaque utilisateur) : menu utilisateur en bas à gauche, **Paramètres**, onglet **Ma boîte mail** (adresse directe : `/settings?tab=mailbox`). Voir la section suivante.
3. **Écrire** : ouvrir la fiche d'un contact ou d'un dossier dans le CRM, onglet **Mails**, bouton **Écrire**.

Aucun connecteur externe (Zapier, Make, Brevo, etc.) n'est nécessaire : l'envoi passe directement par le serveur SMTP de la boîte de l'utilisateur.

## Configurer sa boîte mail

Accès : menu utilisateur, **Paramètres**, onglet **Ma boîte mail**.

L'écran **Ma boîte mail** est personnel : chaque utilisateur configure la sienne, personne d'autre ne peut la lire, l'utiliser ou la modifier, administrateur compris.

1. Choisir un fournisseur (Infomaniak, Gmail, Outlook, OVH) pour préremplir les serveurs, ou **Autre SMTP**.
2. Renseigner l'adresse, le mot de passe, les serveurs SMTP et IMAP, leurs ports et leur sécurité (SSL/TLS ou STARTTLS).
3. Choisir le délai d'annulation : 0, 5, 10, 20 ou 30 secondes (10 par défaut).
4. **Tester la connexion** : le SMTP et l'IMAP sont testés séparément. Dix tests par heure et par utilisateur au plus.
5. **Enregistrer**.

Le mot de passe est chiffré dans la base et n'est jamais renvoyé à l'écran : il s'affiche masqué. Laisser le champ masqué ou vide conserve le mot de passe existant. Si l'adresse ou un serveur change, le mot de passe doit être saisi à nouveau, pour qu'il ne parte jamais vers un serveur modifié. Un mot de passe d'application est recommandé quand la double authentification est active.

Les serveurs doivent être publics : une adresse de réseau privé ou locale est refusée.

## Écrire un mail

L'onglet **Mails** d'une fiche liste les conversations de l'utilisateur avec ce contact. Le bouton **Écrire** ouvre le tiroir de rédaction : destinataires (Cc et Cci en option), objet, corps avec mise en forme simple, pièces jointes (20 Mo au total, depuis l'ordinateur ou la médiathèque) et dossier à rattacher.

Le brouillon est conservé localement, par utilisateur et par organisation. Les pièces jointes d'un brouillon repris sont à joindre à nouveau.

### Annuler un envoi

Après **Envoyer**, le mail est programmé et un message de confirmation propose **Annuler** pendant le délai d'annulation. Annuler rouvre le brouillon et rien n'est envoyé. Passé le délai, le mail part. Un mail déjà parti ne peut plus être annulé.

### Annuler et réessayer depuis le fil de la fiche

Le fil **Activité** d'une fiche dossier ou contact affiche chaque mail avec un badge : **Programmé**, **Envoi en cours**, **Envoyé** ou **Échec**.

- **Annuler l'envoi** : disponible tant que le mail est **Programmé**. Le mail ne part pas et disparaît du fil : les mails annulés ne sont pas affichés.
- **Envoi en cours** : l'annulation n'est plus possible.
- **Réessayer** : disponible sur un mail en **Échec**. Le mail repasse en **Programmé** et part au prochain passage de la file d'envoi. Le réessai est refusé si la limite d'envoi est atteinte ou si aucun compte d'envoi n'est connecté.
- **Résultat incertain** (`delivery_unknown`) : aucun bouton **Réessayer**. Le message demande de vérifier la boîte d'envoi avant tout nouvel essai, pour éviter un doublon.

Le fil ne contient pas de lien « Ouvrir dans Mails ». Chaque utilisateur ne voit que ses propres mails.

Un mail n'est envoyé qu'une seule fois. Si l'état d'un envoi reste incertain, le mail est signalé « État incertain, vérifiez votre dossier Envoyés » et n'est jamais renvoyé automatiquement.

## Trace dans le CRM

Chaque mail envoyé crée une Interaction (type et sens renseignés, intitulé = objet, compte rendu = début du message, pièces jointes) rattachée au dossier et au contact. Un contact sans dossier reçoit un dossier « Contact entrant : nom du contact ». Ces écritures exigent que l'expéditeur ait le droit d'édition sur les bases concernées. Sans ce droit, le mail part mais n'est pas tracé : la trace est abandonnée une fois pour toutes, sans nouvel essai, et le mail reste signalé comme non tracé dans l'onglet Mails. Un dossier existant est rattaché sans écriture, la lecture suffit.

Si la trace échoue après un envoi réussi, le mail n'est pas annulé : l'onglet Mails signale les traces en attente et elles sont rejouées automatiquement.

## Limite d'envoi

Aucun plafond quotidien ne s'applique à l'organisation. Une limite de sécurité de 200 mails par heure et par utilisateur reste active, chaque destinataire comptant pour un mail. Elle est vérifiée à la programmation et à l'envoi réel.

## Confidentialité

- Le fil d'une fiche ne montre que les mails de l'utilisateur connecté, pas ceux de ses collègues. Les Interactions du CRM restent visibles par tous ceux qui lisent la base.
- Le mot de passe de la boîte est exclu des réponses de l'API, des journaux et de l'audit. Les sauvegardes le contiennent uniquement chiffré, avec la clé de chiffrement de l'instance.
- Les envois et les modifications de configuration sont consignés dans le journal d'audit avec leur auteur.
