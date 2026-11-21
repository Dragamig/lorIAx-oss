# Profils clients (composition au build SP2)

Chaque `clients/<client>.json` décrit l'image sur mesure d'un client :

- `client` (string) — identifiant, sert au tag image `loriax-<client>:vX`.
- `plan` (`free` | `growth` | `enterprise`) — socle de modules (cf. `MODULES_BY_PLAN`).
- `modules` (ModuleId[]) — add-ons hors socle. Les dépendances sont étendues
  automatiquement (`whisper` → `livekit`). Les modules `core` sont toujours inclus.
- `meta` (objet libre, optionnel) — label, date, notes.

Build : `bash scripts/build-client.sh <client> [version]` (depuis `loriax-app/`).
Le script exige un arbre git propre et le restaure après le build.

Modules physiquement prunables en SP2 : `studio`, `studiovideo`, `ldap`,
`meeting-rooms`, `livekit`, `whisper`. Les autres (`ai`, `automations`, `backup`,
core) restent compilés et verrouillés au runtime par la licence.
