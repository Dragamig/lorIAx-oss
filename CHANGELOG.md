# Changelog

Toutes les modifications notables sont consignées dans ce fichier.

Le format est inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et le projet suit [Semantic Versioning](https://semver.org/lang/fr/).

## [2.0.0] - 2026-11-21

lorIAx-oss 2.0.0, basée sur LorIAx 1.210.x. Tous les modules sont actifs, sans quota ni clé de licence. Seul le studio vidéo n'est pas inclus.

### Licence

- Le projet passe de la licence MIT à la licence [FSL-1.1-MIT](LICENSE) (Functional Source License 1.1, licence future MIT) : le code peut être utilisé, modifié et redistribué pour tout usage, sauf pour proposer un produit ou un service concurrent.
- Chaque version passe sous licence MIT deux ans après sa publication.
- Les versions 1.21.0 et 1.21.1 ont été publiées sous licence MIT et le restent. Le tag `v1.21.1` donne la dernière version sous licence MIT.
- Les contributions sont soumises au DCO et à une licence accordée au titulaire des droits : voir [CONTRIBUTING.md](CONTRIBUTING.md).

### Ajouté

- **Bases** (`/bases`) : groupes de tables, vues grille, kanban, galerie, calendrier, formulaire et tableau de bord, formulaire public par lien, export CSV et XLSX, synchronisation Airtable et Notion.
- **Automatisations** des bases : déclencheurs sur création, modification, suppression de ligne ou planification ; actions webhook, notification, création ou modification de ligne.
- **CRM** : contacts, dossiers et interactions portés par des bases ordinaires.
- **Médiathèque** : images, PDF et fichiers classés en dossiers et tags.
- **Studio design** : visuels sur canvas, formats réseaux sociaux, exports PNG, SVG et PDF. Bloc Design dans les documents, avec plans de travail ordinateur, tablette et mobile.
- **Banque d'images** : recherche et insertion d'images depuis des banques externes.
- **Salles de réunion** : fiches salles, horaires d'ouverture, droits par utilisateur, équipe et rôle, réservation sans chevauchement, tableau d'occupation, export CSV. Rôle Gestionnaire de salles.
- **Discussion d'équipe** en canaux.
- **Tâches** et vue Gantt du calendrier.
- **Présentations** et **notes vocales**.
- **Assistant d'aide** : réponses aux questions d'usage à partir des fiches d'aide de `docs/kb/`, livrées avec l'application.
- Création de base et aide aux formules assistées par IA, modèle d'IA configurable par fonction (chat, aide, résumés, embeddings), réindexation à la demande.
- Blocs de document : bloc synchronisé et base liée.
- Création et gestion des espaces depuis l'interface.
- Interface traduite en sept langues (français, anglais, allemand, espagnol, breton, japonais, chinois) : conventions et glossaire dans `docs/i18n-conventions.md` et `docs/i18n-glossary.md`.
- `install.sh` et `scripts/generate-env.sh` : installation d'une instance en une commande, avec un `.env` aux secrets aléatoires.

### Changements incompatibles

- **Installation depuis les sources.** `install.sh` ou `docker compose up -d --build` construisent l'application sur le serveur à partir du dépôt. Aucune image préconstruite n'est publiée ni requise.
- **Un seul fichier compose.** Les variantes des versions 1.21.x (production, client, registre) sont supprimées : tout passe par `docker-compose.yml`, complété par `docker-compose.livekit.yml` pour la visioconférence.
- **8 Go de RAM pour construire.** La construction de l'application (`next build`) demande 8 Go de RAM. Une fois construits, les services sont plafonnés à environ 4 Go au total.
- **Migration par le service `app-migrate`.** La base n'est plus migrée à la main. Le service `app-migrate` exécute `scripts/init-db.ts` avant chaque démarrage de l'application, puis s'arrête ; en cas d'échec, l'application ne démarre pas.
- **`CRON_SECRET` obligatoire.** `docker-compose.yml` refuse de démarrer sans le secret des tâches planifiées.
- **Organisation unique par défaut.** L'instance fonctionne avec une seule organisation, créée à l'initialisation de la base. Tous les utilisateurs, espaces et réglages lui sont rattachés, sans sous-domaine.
- **L'application n'écoute que sur la machine.** Aucun port n'est ouvert vers l'extérieur : un reverse proxy HTTPS se place devant l'application.

### Migration depuis une version 1.21.x

Les volumes Docker portent les mêmes noms et le `.env` existant se conserve (ne pas le régénérer).

```bash
# 1. Sauvegarder la base
docker compose exec -T postgres pg_dump -U loriax -Fc loriax > sauvegarde-avant-mise-a-jour.dump

# 2. Récupérer la version 2.0.0
git pull

# 3. Ajouter le secret des tâches planifiées
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env

# 4. Reconstruire et redémarrer
docker compose up -d --build
```

Le service `app-migrate` détecte la base 1.21.x comme non vide : il applique les différences de schéma, crée les colonnes vectorielles, les déclencheurs et l'organisation par défaut, puis inscrit la migration initiale comme déjà appliquée, sans la rejouer. Son journal se lit avec `docker compose logs app-migrate`.

Si la mise à jour partait d'un fichier compose de production, client ou registre, relancer les services avec `docker-compose.yml` seul. La procédure complète est dans [README.md](README.md#mise-à-jour).

### Non inclus

- Studio vidéo.

## [1.21.1]

Dernière version sous licence MIT, repérée par le tag `v1.21.1`.

### Sécurité

- Assistant de configuration protégé par une clé d'installation, routes `/api/setup` authentifiées.
- Protection SSRF centralisée (`safeFetch`), étendue à la synchronisation Notion et au proxy de données.
- Permissions manquantes exigées sur l'IA, le calendrier, les bases et les espaces ; listes filtrées par classification ; lecture d'espace par appartenance implicite fermée.
- Contrôle d'accès aux pièces jointes, neutralisation des SVG, y compris ceux déjà stockés.
- XSS stocké par la synchronisation externe corrigé.
- Révocation de session effective, sessions d'un compte supprimé rejetées.
- Exfiltration par déclassification de document bloquée.

### Corrigé

- Chemins d'installation et démarrage documenté réparés.
- Pièces jointes synchronisées conservées, médias non dégradés à la synchronisation.

## [1.21.0] - 2026-05-22

### Ajouté

- Première publication open source à partir du code de production LorIAx.
- Licence MIT.

### Retiré

- Module de discussion d'équipe.
- Module tâches et vue Gantt.
- Studio vidéo et audio, banques d'images.
- Studio design.
- Réservation de salles de réunion et rôle `facility_manager`.
- Interface de gestion d'espaces (le modèle est conservé, l'interface de création retirée).

### Modifié

- Migrations Drizzle consolidées en une migration de bootstrap `0000_initial.sql`.
- Éditeur TipTap : extension `TaskItem` standard (sans assignation utilisateur).
