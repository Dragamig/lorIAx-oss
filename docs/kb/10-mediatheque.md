---
title: "Médiathèque"
description: "Gérer les images, PDF, vidéos et autres fichiers de LorIAx dans la Médiathèque : téléverser, classer en dossiers et tags, filtrer, mettre à la corbeille et restaurer, droits d'accès et stockage."
---

## Ouvrir la médiathèque

La page **Médiathèque** est dans la barre latérale (`/mediatheque`) et dans la palette de commandes (Ctrl+K). La recherche générale et la palette retrouvent aussi les médias par nom, titre, texte alternatif, tag ou description.

La page affiche à gauche l'arbre des dossiers, des tags et des vues (Tous les médias, Sans dossier, Non utilisés, Mes téléversements, Corbeille), au centre la grille ou la liste des médias, à droite le panneau de propriétés du média sélectionné.

## Téléverser

1. Cliquez sur **Téléverser**, ou déposez des fichiers sur la page.
2. Choisissez l'espace d'origine, un dossier et des tags facultatifs.
3. Lancez l'envoi. Une file affiche l'avancement de chaque fichier.

Chaque fichier fait au plus 50 Mo (200 Mo pour une vidéo, voir **Grosses vidéos** plus bas pour aller jusqu'à 5 Go). Si un fichier identique existe déjà, LorIAx le signale : **Réutiliser l'existant** évite le doublon, **Téléverser quand même** crée une copie. Les formats non acceptés sont refusés avec le motif.

## Classer

- **Dossiers** : **Nouveau dossier** dans l'arbre. Un dossier se renomme, se déplace et se supprime ; à sa suppression, les médias et sous-dossiers remontent d'un niveau.
- **Tags** : ajoutés dans le panneau de propriétés ou en lot. Un clic sur un tag de l'arbre filtre la liste.
- **Déplacer** : glisser un média sur un dossier, ou **Déplacer** dans la barre d'actions groupées.
- **Changer d'espace** : modifie qui peut voir le média. Un avertissement précise l'effet avant confirmation.

## Retrouver et filtrer

La barre de filtres combine recherche, type, tags, espace, auteur de l'ajout, période, taille et **Non utilisés**. **Réinitialiser les filtres** remet tout à zéro. La grille et la liste se trient par date, nom, taille, type ou nombre d'utilisations.

Le panneau de propriétés affiche le titre, le nom du fichier, le texte alternatif, la description, les tags, le dossier, les dimensions et la liste **Utilisé dans** (documents, lignes de bases, designs, Brand Kits, présentations). Un double clic ouvre l'aperçu agrandi des images, PDF, audio et vidéo.

## Télécharger en archive

Un zip se télécharge de deux façons :

- **Une sélection** : cocher des médias dans la grille ou la liste, puis **Télécharger en archive** dans la barre d'actions groupées (200 médias au plus par sélection).
- **Un dossier** : **Télécharger le dossier en archive** dans l'arbre des dossiers. Le dossier et ses sous-dossiers sont inclus, avec leur arborescence.

Un dialogue récapitule la portée, le nombre de fichiers et la taille avant le lancement. Les fichiers sont ajoutés tels quels, sans compression. L'archive contient 500 fichiers et 2 Go au plus ; au-delà, un message l'indique avant tout envoi. Les médias en corbeille ou que vous n'avez pas le droit de lire sont omis et listés dans `_non-inclus.txt` à la racine de l'archive. Une seule archive à la fois par personne, et 3 archives par tranche de 10 minutes.

## Vues enregistrées

Dans la barre de filtres de la Médiathèque, le menu **Vues enregistrées** garde une combinaison de filtres, de tri et de dossier.

- **Enregistrer la vue actuelle** : donner un nom, cocher **Partager avec l'organisation** si besoin. Le bouton est désactivé tant qu'aucun filtre n'est actif.
- **Appliquer** une vue en un clic, **Modifier** (renommer, changer le partage) ou **Supprimer** : seul l'auteur modifie ou supprime ses vues. Les vues partagées apparaissent chez tous les membres de l'organisation, sous « Partagées avec l'organisation ».
- Une vue ne donne aucun droit supplémentaire : la liste ne montre que les médias que vous pouvez lire, et un dossier devenu inaccessible est ignoré.
- 50 vues au plus par personne.

## Grosses vidéos

Au-delà de 200 Mo et jusqu'à 5 Go, une vidéo est envoyée directement vers le stockage par parts de 16 Mo, depuis **Téléverser**. La file affiche la part en cours, la vitesse et le temps restant, avec **Mettre en pause l'envoi**, **Reprendre l'envoi** et **Annuler l'envoi**. Après une coupure, les parts déjà reçues sont conservées 24 h : un bandeau « Envoi interrompu » propose **Reprendre** (choisir de nouveau le même fichier) ou **Abandonner**. Le fichier est vérifié à la fin avant de devenir un média. Si le stockage direct n'est pas configuré sur l'instance, la limite reste à 200 Mo.

## Vignettes des PDF

Un PDF affiche dans la grille la première page en vignette, calculée à l'envoi. Un PDF protégé, corrompu ou trop lourd à dessiner reste utilisable, sans vignette.

## Texte indexé et recherche par contenu

Quand l'organisation a activé l'indexation, le texte des PDF, documents (docx, odt, pptx, odp), tableurs, fichiers texte et les métadonnées des images (jamais la position GPS) est extrait, puis retrouvable dans la recherche et dans les réponses de l'assistant IA. Les audio et vidéos le sont aussi si la transcription est activée. Les images ne sont pas lues par reconnaissance de texte.

- **Fiche média** : cliquer sur un média ouvre le panneau **Propriétés**, section **Texte indexé** (sous Informations, onglet **Informations**). La pastille indique l'état : En attente, En cours, Indexé (date, source, nombre de caractères), Aucun texte trouvé, Ignoré (fichier ou média trop long), Plafond journalier atteint, Moteur indisponible, Échec de l'indexation ou Désactivée par l'organisation. Les états d'attente se relancent seuls.
- **Voir le texte extrait** ouvre un panneau en lecture seule : champ **Rechercher dans le texte** (surlignage, résultat précédent et suivant, Entrée pour passer au suivant), **Copier le texte**. Pour une transcription, chaque ligne porte son horodatage ; depuis l'aperçu agrandi (double clic sur une vidéo ou un audio, bouton **Texte extrait** à côté de la navigation), un clic sur l'horodatage place le lecteur à ce moment.
- **Réindexer** (ou **Réessayer** en cas d'échec) relance l'extraction. Le bouton est grisé, avec la raison en info-bulle, pour une personne qui ne peut pas modifier le média, quand l'indexation est désactivée, ou quand le média est déjà en file ou en cours.
- **Recherche** : la page **Rechercher** (menu de gauche) et la palette de commandes (Ctrl+K) affichent un groupe **Médias, dans le contenu** avec un extrait autour de la correspondance. Seuls les médias que la personne peut lire apparaissent.
- **Réglages (administrateurs)** : **Administration > Modules et services > Médiathèque** (`/admin/library`), carte **IA**. Deux interrupteurs, désactivés par défaut : **Texte et vecteurs** et **Transcription de l'audio et de la vidéo** (qui exige le premier). Les activer ouvre une fenêtre avec l'estimation (médias, blocs de recherche, jetons d'embedding) ; désactiver se fait directement, avec **Annuler** dans la notification, et conserve l'index. **Effacer l'index de l'organisation** supprime tout le texte extrait et les vecteurs. Sans fournisseur d'embedding configuré pour l'instance, les interrupteurs restent grisés. Les plafonds (300 médias indexés par jour, 120 minutes de transcription par jour, fichier de 50 Mo au plus, transcription de 60 minutes au plus, 200 000 caractères conservés par média) sont affichés en lecture seule.

## Retoucher une image

Pour les images jpeg, png, webp et gif (SVG, HEIC et AVIF ne se retouchent pas), le bouton **Retoucher** (touche E) se trouve dans le panneau **Propriétés** d'un média sélectionné et dans l'aperçu agrandi (double clic). Il ouvre le retoucheur en plein écran.

- **Outils** (rail de gauche) : **Recadrer** (formats libres, 1:1, 4:3, 3:2, 16:9, 9:16, 4:5 ou ratio saisi ; poignées à la souris, flèches au clavier), **Pivoter** (quarts de tour, angle fin, miroirs), **Redimensionner** (verrou de ratio, sortie plafonnée à 8 192 px de côté et 24 mégapixels), **Réglages** (luminosité, contraste, saturation, vibrance, exposition, température, teinte), **Filtres**, **Netteté et flou**, **Texte** et **Formes**.
- **Annuler** et **Rétablir** (Ctrl+Z, Ctrl+Maj+Z) couvrent 50 modifications. Maintenir `\` ou le bouton **Avant/après** compare avec l'original. Fermer avec des modifications non enregistrées ouvre un choix : Enregistrer, Abandonner ou Continuer.
- **Enregistrer** : par défaut la retouche devient un **nouveau média** (nom, format PNG, JPEG ou WebP, qualité, espace et dossier au choix) et l'original reste intact. La case **Enregistrer comme nouvelle version de l'original** remplace l'image dans tous les emplacements où elle est utilisée (la liste s'affiche avant) ; l'ancien fichier reste restaurable depuis l'onglet **Versions**. Elle est grisée, avec la raison en info-bulle, sans droit de modification sur l'original. Le message de confirmation propose **Annuler** pendant 10 secondes.
- Une image animée perd son animation (seule la première image est conservée). La position GPS d'un fichier d'origine est conservée dans la copie, un avertissement le signale.
- Sans droit d'écriture dans aucun espace, le retoucheur s'ouvre en lecture seule : le bouton **Télécharger le résultat** remplace Enregistrer. Un contenu identique à un média existant ne crée pas de doublon.
- La fiche d'une copie affiche **Retouché depuis** (lien vers l'original s'il est lisible) ; celle de l'original affiche **Retouches (N)**, limité aux médias que la personne peut lire. Supprimer l'original conserve la copie.

## Corbeille et restauration

**Mettre à la corbeille** demande une confirmation qui liste les emplacements où le média est utilisé. Le média utilisé peut être mis à la corbeille : les contenus concernés affichent alors « média manquant » jusqu'à la restauration. Un message de confirmation propose **Annuler** juste après l'action.

La vue **Corbeille** liste les médias avec leur date de mise à la corbeille, le délai restant avant purge et le nombre de contenus touchés. **Restaurer** remet le média à sa place, avec ses dossiers, tags et usages.

Un média reste 30 jours dans la corbeille (réglable par un administrateur), puis il est supprimé définitivement, fichier compris, même s'il est encore utilisé. Une notification prévient 7 jours avant la purge. Les administrateurs de l'organisation peuvent aussi **Effacer définitivement** un média immédiatement : le nom du fichier est à saisir pour confirmer, et l'action est irréversible.

## Versions d'un média

Dans la **Médiathèque** (`/mediatheque`), sélectionner un média ouvre le panneau **Propriétés** à droite. L'onglet **Versions** liste les versions, la plus récente en haut, avec l'auteur, la date et la taille. La version en cours porte le repère « Courante ».

- **Remplacer le fichier** : choisir ou déposer un nouveau fichier, avec un commentaire facultatif. Le contenu actuel devient une version précédente. L'adresse du média et ses usages (documents, designs, bases) ne changent pas. Le nouveau fichier doit être du même type que le média (une image reste une image) et différer de la version courante. Le message de confirmation propose **Annuler**.
- **Restaurer la version N** : crée une nouvelle version avec le contenu de la version choisie ; l'historique n'est pas réécrit. **Annuler** est proposé dans le message de confirmation.
- **Télécharger la version N** et **Supprimer la version N** (confirmation, définitive). La version courante, ou la seule version, ne peut pas être supprimée.
- Vingt versions sont conservées par média : au-delà, la plus ancienne est supprimée au remplacement. Les versions occupent de l'espace de stockage.
- Un média en corbeille ne peut ni être remplacé ni voir ses versions modifiées : les boutons sont désactivés, l'info-bulle l'explique. Ces actions demandent le droit d'écriture sur le média.

## Droits

- Lecture : toute personne qui a accès à l'espace du média.
- Modification, déplacement, corbeille, restauration : droit d'écriture sur l'espace. Sans ce droit, les boutons sont désactivés et leur info-bulle donne la raison.
- Médias hors espace : visibles de tous les membres de l'organisation.
- Effacement définitif : administrateurs de l'organisation.

## Stockage

L'édition open source n'impose aucune limite de stockage : l'espace disponible dépend du stockage S3 ou du disque configuré pour l'instance. Libérer de la place passe par l'effacement définitif de médias en corbeille.

## Administration

Les administrateurs règlent le délai de purge de la corbeille et consultent l'usage du stockage et les compteurs dans **Administration > Modules et services > Médiathèque** (`/admin/library`). Le module est actif par défaut et peut être désactivé dans la page des modules.

## Choisir un média depuis une autre surface

Le sélecteur de médias s'ouvre en modale depuis l'éditeur, les bases, le Brand Kit, et le studio. Il propose jusqu'à quatre onglets selon la surface :

- **Médiathèque** : grille des médias que vous pouvez lire, avec recherche, filtre de type et de dossier. La sélection est limitée au nombre autorisé par la surface (un seul média, ou un maximum indiqué dans le sélecteur).
- **Téléverser** : envoi depuis l'appareil, dans l'espace du contexte (document ou base). Sans espace de contexte, un menu propose les espaces où vous pouvez écrire ; s'il n'y en a aucun, l'onglet est désactivé et son info-bulle en donne la raison.
- **URL** (insertion d'images) : l'image est copiée dans la médiathèque. Les adresses refusées ou inaccessibles affichent le motif.
- **Banque d'images** (insertion d'images) : recherche chez les fournisseurs configurés par un administrateur, import en un clic dans la médiathèque.

Le pied du sélecteur porte le **texte alternatif**, prérempli avec celui du média. Il s'applique à l'image insérée et ne modifie pas la fiche du média.

## Images et fichiers dans un document

- **Images** : la commande d'insertion ouvre le sélecteur. L'image est stockée comme référence `/api/media/<identifiant>` ; plus aucune image n'est incorporée en base64. Un échec d'envoi affiche un message d'erreur avec **Réessayer**. Les images déjà incorporées en base64 restent affichées telles quelles.
- **Bloc Fichier** : la commande `/Fichier` insère une carte avec le nom, le type et la taille du média, un lien de téléchargement et le bouton **Aperçu** pour les PDF. L'aperçu intégré (560 px de haut) se charge à la demande et utilise le lecteur PDF du navigateur ; si le navigateur le refuse, la carte garde **Télécharger**.
- **Média manquant** : une image ou un bloc Fichier dont le média est en corbeille, supprimé ou illisible affiche l'état « Média manquant ». La restauration depuis la corbeille rétablit l'affichage au rechargement.

## Cellules des bases

- **Image** : le sélecteur choisit un média image et la cellule garde `/api/media/<identifiant>`. Une URL externe ou une image incorporée existante reste affichée et modifiable.
- **Pièces jointes** : le sélecteur accepte plusieurs médias, dans la limite de **20 pièces par cellule**. Une ancienne pièce sans clé de stockage garde son nom affiché, son téléchargement est désactivé et l'info-bulle indique « Fichier introuvable ».

Un média choisi doit être lisible par la personne qui l'ajoute, et appartenir à l'organisation.

## Logos du Brand Kit

Les logos du Brand Kit se choisissent dans la médiathèque, dans un espace ouvert à toute l'organisation. Un logo en URL externe reste accepté. Le rendu des designs lit le logo par l'organisation du Brand Kit.

## Bloc design

- **Bloc design** : les nouvelles miniatures sont des médias d'origine `studio` référencés par `/api/media/<identifiant>`. Les images insérées dans le canevas du studio passent par le sélecteur.

## Automatismes : `create_design`

L'action `create_design` enregistre l'image rendue dans la médiathèque (origine `automation`, espace de l'automatisme ou, à défaut, sans espace). L'URL de sortie est `/api/media/<identifiant>`. Les fichiers déjà écrits avant ce changement ne sont pas migrés.

## Réécriture des références existantes

Les références anciennes (`/api/attachments/<clé>`, `sourceKey`) restent lisibles. Un script les convertit, à lancer depuis `loriax-app/` :

- `npm run media:rewrite-cells` : cellules image et pièces jointes des bases vers `/api/media/<identifiant>` et `{ mediaId }`.

Fonctionnement commun :

- Simulation par défaut : le script écrit un rapport (JSON et texte) et ne modifie rien.
- `--apply` écrit les changements et exige `--confirm-db <nom de la base cible>`. Une base nommée `loriax` exige `--confirm-db loriax` même en simulation.
- Avant l'écriture, les valeurs d'origine sont sauvegardées en JSON dans `tmp/media-rewrite/`. La mise à jour est conditionnelle à la valeur lue, donc une modification concurrente n'est jamais écrasée, et le script peut être relancé sans effet répété.
- Les cas ambigus, introuvables ou sans clé sont laissés intacts et comptés dans le rapport.
- Options : `--limit N`, `--org <uuid>`, `--report <fichier>`.

Les documents ne sont pas réécrits en masse : l'alias ci-dessous sert les anciennes références. Une référence `/api/attachments/<clé>` d'un document non collaboratif est convertie en `/api/media/<identifiant>` à sa prochaine sauvegarde.

## Anciennes adresses de fichiers

Une adresse de la forme `/api/attachments/...`, présente dans un document, ou une cellule, continue d'afficher le fichier. Aucune action n'est demandée aux utilisateurs. L'alias est permanent et suit les mêmes droits d'accès que `/api/media/<identifiant>`.

Les administrateurs disposent de deux scripts, à lancer depuis `loriax-app/` :

- `npm run media:legacy-refs` : compte les références anciennes restantes et contrôle l'intégrité de la copie vers `media`. Lecture seule, code de sortie 0 quand rien ne bloque.
- `npm run media:rewrite-collab` : convertit les anciennes références des documents collaboratifs. Simulation par défaut, `--apply` exige `--confirm-db <nom de la base>`. Le serveur collaboratif doit être arrêté, ou les documents inactifs depuis 10 minutes. Le script refuse de démarrer sans `WORKSPACES_PATH` valide et n'écrit sur le disque que si la seule différence est la substitution des adresses résolues.

## API v1

Les médias se lisent et se téléversent avec une clé d'API (en-tête `Authorization: Bearer lrx_...`). Les clés se créent dans **Paramètres > Clés API**. L'organisation est celle du sous-domaine appelé, et la clé agit avec les droits de son propriétaire. Limite : 100 requêtes par minute et par clé, au-delà la réponse est 429.

### Portées

- `media:read` : lister les médias, lire leurs métadonnées et leur contenu.
- `media:write` : téléverser un média.

Les portées se cochent à la création d'une clé. Une clé créée avant ces portées ne les possède pas : la route répond 403 `Scope manquant : media:read` (ou `media:write`).

### Routes

- `GET /api/v1/media` : liste (`media:read`).
- `POST /api/v1/media` : téléversement (`media:write`).
- `GET /api/v1/media/{id}` : métadonnées (`media:read`).
- `GET /api/v1/media/{id}/content` : contenu (`media:read`).

Chaque réponse suit l'enveloppe `success`. En cas de succès, `data` porte le résultat. En cas d'erreur, `success` vaut `false` et `error` décrit le motif.

### Lister les médias

Paramètres de requête :

- `q` : recherche texte, 200 caractères au plus (le surplus est tronqué).
- `kind` : type, répétable. Valeurs : `image`, `pdf`, `document`, `video`, `audio`, `archive`, `other`. Toute autre valeur répond 400.
- `spaceId` : identifiant d'espace, ou `none` pour les médias hors espace.
- `folderId` : identifiant de dossier, ou `none` pour les médias sans dossier.
- `tag` : identifiant de tag (UUID, pas un libellé), répétable, 50 au plus.
- `limit` : de 1 à 100, 50 par défaut. Une valeur supérieure à 100 est ramenée à 100. Zéro ou une valeur non numérique répond 400.
- `cursor` : valeur `nextCursor` de la page précédente.
- `sort` : `createdAt` (défaut), `filename`, `sizeBytes`, `kind` ou `usageCount`.
- `dir` : `desc` (défaut) ou `asc`.

Le curseur porte le tri qui l'a produit. Si `sort` change entre deux pages, la réponse est 400 `Curseur invalide`, comme pour un curseur forgé.

Les paramètres `view`, `uploadedBy`, `id`, `from`, `to`, `minSize` et `maxSize` sont ignorés. La liste ne contient que les médias hors corbeille.

Réponse 200 :

```json
{
  "success": true,
  "data": [{ "id": "…", "filename": "logo.png", "tags": ["marque"] }],
  "nextCursor": "…",
  "meta": { "cursor": "…", "hasMore": true }
}
```

`nextCursor` et `meta.cursor` ont la même valeur. Sur la dernière page, les deux valent `null` et `hasMore` vaut `false`.

### Métadonnées d'un média

`data` contient : `id`, `filename`, `title`, `altText`, `kind`, `mimeType`, `sizeBytes`, `width`, `height`, `spaceId`, `folderId`, `tags` (libellés, triés), `createdAt`, `updatedAt` (ISO 8601), `url` et `contentUrl`.

`url` (`/api/media/{id}`) s'ouvre dans l'application et exige une session. Avec une clé d'API, utilisez `contentUrl`.

La réponse ne contient aucune clé de stockage, ni empreinte, ni identifiant d'organisation ou d'auteur.

### Contenu d'un média

`GET /api/v1/media/{id}/content` renvoie les octets, avec pour type `mimeType`.

- Affichage inline pour les images PNG, JPEG, GIF, WebP et AVIF, les PDF, l'audio et la vidéo. Les autres types, dont SVG et HTML, sont téléchargés (`Content-Disposition: attachment`).
- En-têtes : `ETag`, `Cache-Control: private, no-cache`, `X-Content-Type-Options: nosniff`, `Accept-Ranges: bytes`.
- Le client revalide à chaque lecture : `If-None-Match` correspondant à l'ETag répond 304.
- Un `Range` valide répond 206. Un intervalle hors taille répond 416 avec `Content-Range: bytes */<taille>`. Un `Range` invalide ou non reconnu (intervalle multiple, forme inconnue) répond aussi 416.

### Téléverser un média

`POST /api/v1/media`, en `multipart/form-data` :

- `file` : le fichier (obligatoire).
- `spaceId` : UUID de l'espace (obligatoire). L'espace doit être accessible en écriture à l'utilisateur de la clé.
- `folderId` : UUID d'un dossier de l'organisation (facultatif).
- `tags` : libellé de tag, répétable (facultatif). Un libellé inconnu crée le tag.

Limites :

- 50 Mo par fichier, 200 Mo si le type MIME commence par `video/`. Pour txt, csv, json, xml, yaml, yml, md et svg, le type MIME est déduit de l'extension, jamais du type déclaré par le client.
- Corps de requête : l'en-tête `Content-Length` est obligatoire. Il est contrôlé avant toute lecture du corps : absent ou supérieur à 201 Mo, la réponse est 413.
- Tags : 20 au plus, 120 caractères au plus par libellé, libellé non vide une fois normalisé. Sinon la réponse est 400 et rien n'est enregistré.
- Débit : 10 téléversements par minute et par clé, au-delà la réponse est 429.
- Extensions acceptées : pdf, doc, docx, xls, xlsx, ppt, pptx, odt, ods, odp, txt, csv, json, xml, yaml, yml, md, png, jpg, jpeg, gif, webp, svg, bmp, ico, mp4, webm, mp3, wav, ogg, zip, tar, gz.
- Pour les formats binaires, le contenu doit être reconnu et correspondre à l'extension. Pour txt, csv, json, xml, yaml, yml, md et svg, ce contrôle des octets n'est pas fait.
- Fichiers `video/` : types `video/mp4`, `video/quicktime`, `video/webm`, `video/x-msvideo` et `video/x-matroska`, contenu reconnu comme média.
- Le média est enregistré avec l'origine `upload`.

Réponse 201 : `data` contient le média, au même format que la lecture des métadonnées.

Exemples :

```bash
curl -H "Authorization: Bearer lrx_..." \
  "https://<organisation>.<domaine>/api/v1/media?kind=image&spaceId=<uuid-espace>&limit=20"

curl -X POST "https://<organisation>.<domaine>/api/v1/media" \
  -H "Authorization: Bearer lrx_..." \
  -F "file=@./logo.png" \
  -F "spaceId=<uuid-espace>" \
  -F "folderId=<uuid-dossier>" \
  -F "tags=marque" -F "tags=logo"
```

Codes d'erreur du téléversement :

- 400 : `Tags invalides (…)`, `Corps multipart invalide`, `Fichier requis`, `spaceId requis (UUID)`, `Extension .xxx non autorisée`, `Type de fichier incohérent : …`, `Type de fichier non autorisé` (fichier vidéo), `Dossier introuvable`.
- 401 : clé absente, invalide ou expirée (`Clé API invalide ou expirée`, ou `Non autorisé`).
- 403 : `Scope manquant : media:write`.
- 404 : `Espace introuvable` (espace inconnu, d'une autre organisation, ou sans droit d'écriture).
- 413 : `Fichier trop volumineux (max 50 Mo)` ou `(max 200 Mo)` pour une vidéo, ou corps annoncé trop grand ou sans `Content-Length`.
- 415 : `Type de fichier non reconnu` ou `Le contenu du fichier n'est pas un média reconnu`.
- 429 : `Limite de requêtes dépassée` (10 téléversements par minute et par clé).
- 500 : `Échec de l'envoi du fichier`.

### Lectures refusées

Un média absent, d'une autre organisation, en corbeille, illisible pour la clé, ou un identifiant qui n'est pas un UUID répond 404 `Média introuvable`. Les réponses ne permettent pas de distinguer ces cas. Une clé sans la portée requise répond 403 avant toute recherche.

### Modifier et supprimer

Les routes v1 ne modifient ni ne suppriment de médias : elles n'exposent que `GET`, et `POST` sur `/api/v1/media`. Renommer, déplacer, taguer ou mettre à la corbeille se fait dans l'application.

## Studio design, tableau blanc et automatismes

- **Studio design** : l'insertion d'image propose la médiathèque en plus du téléversement local. **Enregistrer dans la médiathèque** place l'export (PNG, SVG ou PDF) dans la médiathèque. Les images d'un design apparaissent dans **Utilisé dans** du média après la sauvegarde du design.
- **Tableau blanc** : le bouton d'insertion d'image ouvre le sélecteur de la médiathèque. Les images insérées et la miniature du tableau figurent dans **Utilisé dans**.
- **Automatismes** : le déclencheur **Média ajouté** se lance à chaque téléversement, avec une portée au choix : tous les médias, les médias hors espace, ou ceux d'un espace. Le créateur de l'automatisme doit pouvoir lire le média.
- **Anciennes images du studio** : les adresses `/api/studio/images/<id>` redirigent vers `/api/media/<id>`.
