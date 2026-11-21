# Module Salles de réunion

> Sprint 12 — implémenté en 7 PRs sur la branche `claude/meeting-room-management-6FBVr`.

## Vue d'ensemble

Le module permet à une organisation de gérer ses salles de réunion physiques :
création de fiches (adresse, plan, photo, équipement, horaires d'ouverture),
attribution de droits granulaires, réservation auto-validée, intégration au
calendrier interne et suivi d'occupation.

## Activer le module

1. **En tant qu'admin / super_admin** : aller dans `Administration → Système → Modules optionnels`
2. Activer le toggle « Gestion des salles de réunion ». Le flag est persisté dans
   la table `system_settings` (clé `meeting_rooms_enabled`).
3. Optionnel : attribuer le rôle « Gestionnaire de salles » (`facility_manager`) à
   un ou plusieurs utilisateurs dans `Administration → Utilisateurs`.

Quand le module est désactivé, toutes les routes `/api/meeting-rooms/...`
renvoient un `404`, l'onglet « Salles » disparaît de l'administration et de la
section Organisation.

## Rôles

| Rôle | Peut gérer les salles | Peut réserver |
|---|---|---|
| `super_admin` | ✓ | ✓ (toutes les salles) |
| `admin` | ✓ | ✓ (toutes les salles) |
| `facility_manager` | ✓ | ✓ (toutes les salles) |
| `editor`, `viewer` | ✗ | ✓ uniquement si autorisé explicitement |

Le rôle `facility_manager` est volontairement **parallèle** à `editor` dans la
hiérarchie : il ne donne pas accès aux autres onglets administratifs (users,
teams, system, etc.). C'est un rôle « métier », pas un rôle technique.

### Périmètre exact du `facility_manager`

Peut faire :
- Créer / modifier / supprimer toutes les salles
- Uploader photos et plans
- Gérer la matrice de droits par salle (utilisateurs, équipes, rôles)
- Annuler n'importe quelle réservation (même celles d'autres utilisateurs)
- Consulter et exporter les statistiques d'occupation
- Réserver toutes les salles sans restriction

Ne peut PAS faire :
- Modifier les utilisateurs ou les rôles globaux (réservé `super_admin`)
- Accéder aux onglets Équipes, IA, Mails, Templates, Visio, Licence, Système,
  Services, Sauvegardes — l'onglet « Salles » est le seul visible

## Droits de réservation — matrice à 3 axes

Une salle peut être autorisée à la réservation selon **trois axes**
combinables (logique OR) :

1. **Personne (`user`)** — accorde le droit à un utilisateur précis
2. **Équipe (`team`)** — accorde le droit à tous les membres d'une équipe
3. **Rôle / poste (`role`)** — accorde le droit à tous les utilisateurs ayant
   ce `globalRole` (ex : tous les `editor`, ou tous les `admin`)

Un utilisateur peut réserver une salle s'il satisfait **au moins une** des
conditions enregistrées. Les administrateurs et `facility_manager` passent
toujours, sans matrice.

Exemples d'usage :
- « Salle Atlas réservable par toute l'équipe Marketing » → un seul ajout
  axe `team`
- « Salle stratégique réservable uniquement par les admins » → axe `role`
  avec valeur `admin`
- « Salle de direction réservable par Alice et Bob » → deux ajouts axe `user`
- « Salle de coworking ouverte à tous les éditeurs sauf intérimaires » →
  axe `role=editor` puis retirer manuellement les intérimaires (V2 : exclusions)

L'interface admin présente trois sections distinctes (Rôles / Équipes /
Utilisateurs) avec un toggle d'autorisation pour chaque entrée.

## Créer une salle

`Administration → Salles → Nouvelle salle`. Champs :

- **Nom** (obligatoire), **adresse**, **étage**
- **Capacité** (nombre de places assises)
- **Description** libre
- **Équipement** : tags multiples (vidéoprojecteur, visioconférence, etc.)
- **Horaires d'ouverture** : éditeur jour-par-jour, plusieurs créneaux possibles
  (utile pour gérer une pause déjeuner)
- **Photo** et **plan** : upload via S3, conversion automatique en WebP 2048px
- **Active** : permet de suspendre temporairement les réservations

## Attribuer les droits

Bouton « Gérer les droits » sur chaque salle. La matrice liste tous les
utilisateurs et toutes les équipes ; cocher l'équipe « Marketing » suffit à
autoriser tous ses membres à réserver. Combinable avec des autorisations
individuelles.

## Réserver

Depuis `Organisation → Salles de réunion → [salle] → Réserver`. La réservation
est confirmée immédiatement si l'utilisateur a le droit. Validations :

- Plage horaire dans les horaires d'ouverture du jour
- Hors jours fériés français (liste statique 2026-2027)
- Pas de chevauchement avec une autre réservation confirmée
  (vérifié au niveau Postgres via `EXCLUDE USING gist`)

En cas de conflit, l'API renvoie un `409` avec le message « Créneau déjà
réservé sur cette salle ».

## Intégration calendrier

Chaque réservation crée un événement dans le calendrier organisation
« Salles de réunion » (créé automatiquement à la première utilisation). Cet
événement apparaît dans toutes les vues calendrier de l'application avec une
icône salle (`DoorOpen`). Annuler la réservation supprime l'événement et envoie
une notification (`meeting_room_cancelled`) à tous les participants ayant un
compte LorIAx.

## Suivi d'occupation

`Organisation → Occupation` (visible uniquement par admin et facility_manager) :

- Réservations par salle sur 7 ou 30 jours
- Top 5 utilisateurs
- Histogramme horaire des créneaux populaires
- Export CSV BOM UTF-8 (compatible Excel) sur la période

## Seed de démo

```bash
npm run db:seed:meeting-rooms              # crée 2 salles d'exemple
npx tsx scripts/seed-meeting-rooms.ts --enable  # + active le flag
```

Idempotent : ne crée pas de doublon si une salle du même nom existe déjà.

## Architecture technique

```
src/app/api/meeting-rooms/                 # 8 routes API
src/app/(app)/admin/meeting-rooms/         # gestion CRUD
src/app/(app)/organisation/                # consultation + réservation
src/components/meeting-rooms/              # composants partagés
src/lib/meeting-rooms/                     # logique métier
  ├── feature-flag.ts
  ├── guards.ts
  ├── permissions.ts        # canBookRoom, listBookableRoomIds
  ├── opening-hours.ts      # validation + computeAvailability
  ├── holidays-fr.ts        # statique 2026-2027
  └── calendar-link.ts      # calendrier organisation dédié
src/lib/db/schema.ts                       # 3 tables + meeting_room_id
src/lib/db/migrations/0010_meeting_rooms.sql
```

## Limitations connues (V2)

- Mono-site uniquement (pas de hiérarchie Site → Étage → Salle)
- Sync CalDAV bidirectionnelle (Google Calendar / Outlook / Apple) pas
  implémentée — les événements vivent uniquement dans le calendrier interne
- Pas de workflow de validation manuelle (auto-confirmé si droit présent)
- Pas de récurrence sur les réservations
- Liste de jours fériés statique 2026-2027 (à remplacer par `date-holidays`)
- Pas de check-in QR code ni de no-show automatique
