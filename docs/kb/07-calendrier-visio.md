---
title: "Calendrier et visioconférence"
description: "Gérer son agenda et ses réunions dans LorIAx : calendrier partagé compatible CalDAV, événements, vues mois/semaine/jour/agenda/Gantt, visioconférence LiveKit et transcription à activer en réunion."
---

## Accès

- **Calendrier** : entrée **Calendrier** de la barre latérale (`/calendar`), ou onglet **Calendrier** de la barre du bas sur mobile. Une vue s'ouvre directement par l'adresse, par exemple `/calendar?view=week`.
- **Visioconférence** : entrée **Réunions** de la barre latérale (`/meet`), ou onglet **Réunion** de la barre du bas sur mobile.
- **Dans un document** : tapez `/` puis **Calendrier**, **Événement**, **Réunion** ou **Réunion présentielle** (les deux dernières selon les modules actifs).

## Le calendrier

Le calendrier de LorIAx est partagé et compatible avec les standards d'agenda. Les boutons **Mois**, **Semaine**, **Jour**, **Agenda** et **Gantt** changent la vue, **Aujourd'hui** revient à la date du jour.

### Vues disponibles

- Mois
- Semaine
- Jour
- Agenda (liste des événements)
- Gantt (planning sous forme de diagramme de Gantt)

### Événements

- Créez des événements avec titre, dates et heures : bouton **Événement** en haut du calendrier, puis **Créer** dans le formulaire **Nouvel événement**. Le bouton **Réunion** ouvre le même formulaire avec la visio activée (case **Réunion visio**).
- Ajoutez des participants et des rappels.
- Définissez des événements récurrents.
- Insérez un mini-calendrier ou un événement directement dans un document via `/` (blocs Calendrier et Événement).

### Compatibilité CalDAV et iCal

- LorIAx est compatible **CalDAV** : vous pouvez le connecter à Thunderbird, Apple Calendar ou DAVx⁵.
- Import et export au format **iCal (.ics)**.
- Abonnement à des calendriers externes.

## Visioconférence

LorIAx intègre la visioconférence (technologie WebRTC LiveKit), accessible depuis la page **Réunions** (`/meet`) de la barre latérale.

### Lancer ou rejoindre une réunion

- Créez une réunion via le bloc « Réunion » dans un document (`/` puis **Réunion**) ou depuis la page **Réunions** : **Nouvelle réunion** lance une réunion immédiate, **Planifier** la programme.
- La page **Réunions** classe les réunions en **Planifiées**, **En cours**, **En traitement** et **Récentes**. Le bouton **Rejoindre** d'une carte ouvre la salle.
- Invitez des participants. Les invités externes peuvent rejoindre sans compte (lien invité).

### Enregistrement et transcription

- La réunion peut être enregistrée (audio) : dans la salle, cliquez sur **Activer la transcription** (en haut à droite). Un indicateur **REC** et la durée s'affichent alors. Sans ce clic, rien n'est enregistré ni transcrit.
- Pour finir, cliquez sur **Terminer la réunion** : la transcription convertit ensuite la parole en texte.
- L'identification des intervenants (diarisation) attribue les passages aux différents locuteurs.
- Un résumé IA de la réunion est généré automatiquement sous forme de document dans l'espace, dans le dossier **Comptes rendus**. Sur la page **Réunions**, le bouton **Compte-rendu** de la carte y mène dès que le statut indique « Compte-rendu prêt ».

### Réunion présentielle (dictaphone)

Pour une réunion en personne, le bloc « Réunion présentielle » fonctionne comme un dictaphone : il enregistre, transcrit et identifie les intervenants.

## Questions fréquentes

**Comment voir mon planning sous forme de diagramme de Gantt ?**
Ouvrez **Calendrier** dans la barre latérale et cliquez sur **Gantt**.

**Puis-je synchroniser LorIAx avec mon agenda habituel ?**
Oui, via CalDAV (Thunderbird, Apple Calendar, DAVx⁵) ou en important/exportant un fichier .ics.

**Une personne externe peut-elle rejoindre une visio sans compte ?**
Oui, avec le lien d'invitation invité.

**La réunion est-elle transcrite automatiquement ?**
Oui, à condition d'avoir cliqué sur **Activer la transcription** dans la salle : après **Terminer la réunion**, la transcription, l'identification des intervenants et le résumé IA sont produits, le compte rendu étant rangé en document.

**Comment prendre des notes d'une réunion en présentiel ?**
Utilisez le bloc « Réunion présentielle » qui enregistre et transcrit la discussion.
