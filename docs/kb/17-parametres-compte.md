---
title: "Paramètres du compte"
description: "Régler son compte LorIAx : menu utilisateur, page Paramètres et ses onglets Général (profil, avatar, thème, apparence, presets), Clés API (jeton lrx_, permissions, expiration, révocation, API v1), Webhooks (événements, signature X-LorIAx-Signature HMAC-SHA256, test, livraisons), Ma boîte mail, badges et CalDAV."
---

## Ouvrir les paramètres

1. Cliquez sur votre nom, en bas de la barre latérale. Le menu utilisateur s'ouvre.
2. Cliquez sur **Paramètres**.

La page **Paramètres** (`/settings`) affiche des onglets en haut : **Général**, **Clés API**, **Webhooks** et **Ma boîte mail**. Chaque onglet a une adresse directe `/settings?tab=<id>` : `general`, `api-keys`, `webhooks`, `mailbox`.

Le menu utilisateur propose aussi **Mode sombre** (ou **Mode clair**), **Mon équipe**, **Mes badges**, **Relancer le tuto**, **Langue** et **Déconnexion**.

## Onglet Général

- **Profil** : choisissez l'avatar **VizHash (artistique)** ou **Photo de profil**. **Ajouter une photo** accepte JPG, PNG ou WebP, 2 Mo au plus, puis propose **Recadrer la photo** et **Valider**. Modifiez votre **Nom**. L'**Email** ne peut pas être modifié. Le **Rôle** et la date **Membre depuis** sont affichés.
- **Apparence** : **Thème** (**Clair**, **Sombre**, **Système**), **Couleur d'accentuation**, **Taille de police de l'éditeur**, **Police de l'éditeur**, **Fond de l'éditeur**, **Largeur du contenu**.
- **Synchronisation du calendrier** : **Synchroniser avec un autre agenda** ouvre la page **Paramètres CalDAV** (voir plus bas).
- **Presets d'apparence** : **Presets prédéfinis** (Classique, Focus, Rédaction, Style, Terminal), **Mes presets personnalisés** avec **Créer un preset**, **Importer** (fichier JSON), exporter, partager, modifier ou supprimer, et **Bibliothèque communautaire** (**Parcourir**). En mode Terminal, les réglages d'apparence individuels ne s'appliquent pas ; les **Effets CRT : Terminal** les remplacent.

Cliquez sur **Sauvegarder**, en bas de l'onglet, pour enregistrer le nom et l'apparence.

## Onglet Clés API

Une clé API donne accès à l'API LorIAx v1 depuis une application externe. Elle agit avec vos droits.

### Créer une clé

1. Cliquez sur **Nouvelle clé**.
2. Saisissez un **Nom**.
3. Cochez au moins une **Permissions** : **Documents (lecture)**, **Documents (écriture)**, **Espaces (lecture)**, **Espaces (écriture)**, **Recherche**, **Webhooks**, **Calendrier (lecture)**, **Calendrier (écriture)**, **Médiathèque (lecture)**, **Médiathèque (écriture)**. **Tout sélectionner** coche tout.
4. Choisissez l'**Expiration** : **Pas d'expiration**, **30 jours**, **90 jours**, **180 jours** ou **1 an**.
5. Cliquez sur **Créer la clé**.
6. Copiez la clé tout de suite : elle ne sera plus visible après. Puis **Compris, fermer**.

La clé commence par `lrx_`. Seul son début (`lrx_` et 8 caractères) reste affiché dans la liste, avec la date de création, l'expiration, les permissions et la **Dernière utilisation**. Une clé échue porte la mention **Expirée**.

Limite : 20 clés par utilisateur (**Clés actives**, sur 20). Une clé expirée compte dans cette limite tant qu'elle n'est pas révoquée.

### Révoquer une clé

Cliquez sur **Révoquer** sur la ligne de la clé. Une fenêtre demande confirmation : **Révoquer la clé** confirme, **Annuler** renonce. La révocation est alors immédiate et définitive, la clé disparaît de la liste et les applications qui l'utilisent perdent l'accès.

### Utiliser une clé avec l'API v1

Envoyez l'en-tête `Authorization: Bearer lrx_...`. Limite : 100 requêtes par minute et par clé (réponse 429 au-delà). Une permission manquante répond 403 (`Scope manquant : ...`).

Routes et permissions :

- `GET /api/v1/spaces` : **Espaces (lecture)**.
- `GET /api/v1/spaces/{slug}/documents`, `GET /api/v1/documents/{id}`, `GET /api/v1/documents/{id}/comments` : **Documents (lecture)**.
- `POST /api/v1/documents`, `PATCH` et `DELETE /api/v1/documents/{id}`, `POST /api/v1/documents/{id}/comments` : **Documents (écriture)**.
- `GET /api/v1/search?q=...` : **Recherche**.
- `/api/v1/webhooks` : **Webhooks**.
- `/api/v1/calendars` et `/api/v1/events` : **Calendrier (lecture)** pour lire, **Calendrier (écriture)** pour créer, modifier ou supprimer.
- `/api/v1/media` : **Médiathèque**, détaillé dans la fiche Médiathèque.

Les réponses suivent l'enveloppe `{ "success": true, "data": ... }`, ou `{ "success": false, "error": "..." }` en cas d'erreur.

## Onglet Webhooks

Un webhook envoie une requête HTTP POST à votre URL quand un événement se produit dans LorIAx.

### Créer un webhook

1. Cliquez sur **Nouveau webhook**.
2. Saisissez l'**URL de destination**. Les adresses privées sont refusées par défaut.
3. Cochez les **Événements** : **Document créé**, **Document modifié**, **Document supprimé**, **Commentaire ajouté**, **Commentaire résolu**, **Membre ajouté**, **Membre retiré**, **Mention créée**.
4. Facultatif : **Filtrer par espace (optionnel)**. Seuls les événements de cet espace déclencheront alors le webhook. Il faut pouvoir lire cet espace.
5. Cliquez sur **Créer le webhook**.
6. Copiez le secret affiché : il ne sera plus visible après.

Limite : 20 webhooks par utilisateur et par organisation.

### Signature

Chaque livraison porte les en-têtes `X-LorIAx-Signature` (`sha256=` suivi de la signature HMAC-SHA256 du corps, calculée avec le secret), `X-LorIAx-Event` (type d'événement) et `X-LorIAx-Delivery` (identifiant de livraison). Recalculez la signature avec votre secret pour vérifier la provenance.

### Gérer un webhook

- **Activer** / **Désactiver** : bouton de la ligne. La réactivation remet le compteur d'échecs à zéro.
- **Envoyer un test** : émet un événement `document.created` de test. Indisponible sur un webhook désactivé.
- **Supprimer** : une fenêtre demande confirmation (**Supprimer le webhook** ou **Annuler**). La suppression est définitive et efface aussi l'historique des livraisons.
- La flèche à gauche de l'URL affiche les **Dernières livraisons** (20 au plus) : code HTTP, événement, **Livré** ou **Échec**, date. **Actualiser** recharge la liste.

Une livraison échouée est retentée après 10 secondes, 1 minute puis 5 minutes. Après 10 échecs consécutifs, le webhook est désactivé. À partir de 5 échecs, la ligne affiche le nombre d'échecs.

## Onglet Ma boîte mail

Il configure la boîte mail personnelle utilisée pour envoyer des mails depuis le CRM. Voir la fiche Mailing.

## Mes badges

**Mes badges**, dans le menu utilisateur, ouvre **Mon profil** (`/settings/profile`) : vos badges et votre progression dans LorIAx.

## Synchronisation CalDAV

La page **Paramètres CalDAV** (`/settings/calendar`) s'ouvre depuis l'onglet **Général**, section **Synchronisation du calendrier**, lien **Synchroniser avec un autre agenda**. Elle donne votre **URL CalDAV personnelle**, avec un bouton pour la copier, l'adresse d'**Auto-découverte** (`/.well-known/caldav`) et des guides pour Thunderbird, Apple Calendar et DAVx⁵. Identifiants : votre email et votre mot de passe LorIAx. Si votre client accepte un jeton (en-tête `Authorization: Bearer`), une clé API cochée **Calendrier (lecture)** ou **Calendrier (écriture)** convient aussi ; une clé sans permission calendrier est refusée. CalDAV doit être activé sur l'instance par l'administrateur.

## Questions fréquentes

**Où trouver mes paramètres ?**
Menu utilisateur en bas de la barre latérale, puis **Paramètres**.

**J'ai perdu ma clé API. Puis-je la revoir ?**
Non. Révoquez-la et créez-en une nouvelle.

**Mon appel API répond 403 « Scope manquant ».**
La clé n'a pas la permission requise. Créez une clé avec la bonne case cochée : les permissions d'une clé existante ne se modifient pas dans l'onglet.

**Mon webhook est « Désactivé » tout seul.**
Il a échoué 10 fois de suite. Corrigez l'URL de destination, puis cliquez sur **Activer**.

**Comment changer mon email ?**
L'onglet **Général** ne le permet pas.
