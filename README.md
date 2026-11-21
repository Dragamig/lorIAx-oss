<div align="center">

# LorIAx

**Votre savoir, votre infrastructure, votre intelligence.**

Plateforme de gestion de connaissances collaborative et auto-hébergée, avec IA intégrée.

Créé par Studio Dragamig avec l'aide de Claude d'Anthropic

[Lancement rapide](#lancement-rapide) • [Fonctionnalités](#fonctionnalités) • [Architecture](#architecture) • [Configuration](#configuration) • [Déploiement](#déploiement) • [Contribuer](#contribuer) • [Licence](#licence)

</div>

---

LorIAx réunit un éditeur de documents riche, la collaboration en temps réel, des bases de données, un calendrier partagé, la visioconférence et une IA branchée sur vos propres documents. L'ensemble tourne sur votre serveur, avec PostgreSQL et un stockage objet S3 que vous hébergez vous-même.

> **Pour qui ?** Les organismes multi-services qui veulent garder leurs données chez eux : collectivités, associations, PME structurées.

**Version** : lorIAx-oss 2.0.0, basée sur LorIAx 1.210.x, sous licence FSL-1.1-MIT. Tous les modules sont actifs, sans quota ni clé de licence. Seul le studio vidéo n'est pas inclus. Les versions 1.21.0 et 1.21.1 restent sous licence MIT : le tag [`v1.21.1`](https://github.com/Flavien-Dragamig/lorIAx-oss/tree/v1.21.1) donne la dernière version MIT.

## Lancement rapide

Installation sur un serveur Linux avec Docker, à la main ou pilotée par un assistant en ligne de commande. Les exemples prennent un VPS Hostinger ; tout serveur Ubuntu avec Docker convient.

**Dimensionnement** : 8 Go de RAM pour construire l'application (`next build` est gourmand en mémoire). Une fois construits, les services de `docker-compose.yml` sont plafonnés à environ 4 Go au total (application 2 Go, PostgreSQL 1 Go, Garage 512 Mo, sauvegarde 256 Mo). L'IA locale Ollama, facultative, peut prendre jusqu'à 8 Go de plus.

**Code** : le dépôt est public et se clone sans authentification. `docker-compose.yml` construit l'application depuis les sources, aucune image préconstruite n'est requise.

<details>
<summary><strong>Avec les commandes</strong></summary>

1. Créer le serveur (chez Hostinger : modèle Ubuntu avec Docker dans hPanel), ajouter sa clé SSH publique, puis s'y connecter : `ssh root@<ip-du-serveur>`.
2. Vérifier Docker : `docker --version` et `docker compose version`. `openssl`, `curl` et `git` sont aussi nécessaires.
3. Récupérer le code et lancer l'installeur.

   ```bash
   git clone https://github.com/Flavien-Dragamig/lorIAx-oss.git
   cd lorIAx-oss
   LORIAX_URL=https://wiki.exemple.fr bash install.sh
   ```

   `install.sh` vérifie les prérequis, écrit le `.env` avec des secrets aléatoires (`scripts/generate-env.sh`), construit l'application, démarre les services et affiche la clé d'installation. Sans `LORIAX_URL`, il demande l'adresse publique. Un `.env` déjà présent est conservé tel quel. L'option `--livekit` ajoute la visioconférence : `bash install.sh --livekit`.

   Les mêmes étapes à la main :

   ```bash
   bash scripts/generate-env.sh https://wiki.exemple.fr > .env
   chmod 600 .env
   docker compose up -d --build
   ```

4. Vérifier le démarrage : `curl -fsS http://127.0.0.1:3000/api/health`. Les journaux se lisent avec `docker compose logs -f app`.
5. Placer un reverse proxy HTTPS (Caddy, Nginx ou Traefik) devant `http://127.0.0.1:3000`. L'application n'écoute que sur la machine, aucun port n'est ouvert vers l'extérieur. Exemple de `Caddyfile` :

   ```text
   wiki.exemple.fr {
       reverse_proxy 127.0.0.1:3000
   }
   ```

6. Faire pointer le domaine vers l'IP du serveur (enregistrement A, chez le registrar ou dans hPanel).
7. Ouvrir `https://wiki.exemple.fr/setup` pour créer le premier super administrateur. La clé demandée est celle affichée par `install.sh` ; elle se relit avec `grep '^SETUP_BOOTSTRAP_TOKEN=' .env` et cesse d'être acceptée une fois la configuration terminée.

Ne jamais versionner le `.env` : il contient les secrets de l'instance. Les régénérer rend la base et le stockage existants inaccessibles.

</details>

<details>
<summary><strong>Avec Claude Code</strong></summary>

Le plugin `hostinger` (marketplace officielle `claude-plugins-official`) déclare le serveur MCP distant Hostinger (`https://mcp.hostinger.com`) : VPS, pare-feu, snapshots, domaines, DNS. Ses skills de déploiement ciblent l'hébergement mutualisé, pas un VPS Docker : pour LorIAx, le plugin crée le VPS et gère le DNS, le reste passe par SSH et Docker Compose.

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install hostinger@claude-plugins-official
```

La première commande est inutile si la marketplace officielle est déjà présente. L'authentification se fait par OAuth dans le navigateur à la première utilisation, ou par un jeton d'API créé dans hPanel (`HOSTINGER_API_TOKEN`).

Invite à donner à Claude Code :

```text
Déploie LorIAx sur un VPS Hostinger avec le plugin Hostinger. Crée un VPS Ubuntu avec Docker (8 Go de RAM),
connecte-toi en SSH, clone le dépôt (git clone https://github.com/Flavien-Dragamig/lorIAx-oss.git),
lance LORIAX_URL=https://<domaine> bash install.sh depuis la racine du dépôt, installe un reverse proxy HTTPS
pour mon domaine <domaine> devant http://127.0.0.1:3000, crée l'enregistrement DNS et vérifie /api/health.
Ne m'affiche aucun secret, sauf la clé d'installation de /setup.
```

</details>

<details>
<summary><strong>Avec Gemini CLI (Google)</strong></summary>

Brancher le serveur MCP distant Hostinger (`https://mcp.hostinger.com`) dans Gemini CLI.

Par OAuth :

```bash
gemini mcp add --scope user --transport http hostinger https://mcp.hostinger.com
```

Puis, dans Gemini CLI, `/mcp auth hostinger` ouvre le navigateur pour autoriser l'accès (un navigateur local est requis : sans lui, utiliser le jeton).

Par jeton d'API (créé dans hPanel, rubrique API) : ajouter l'en-tête à la commande, ou le déclarer dans `~/.gemini/settings.json`.

```bash
gemini mcp add --scope user --transport http --header "Authorization: Bearer <jeton>" hostinger https://mcp.hostinger.com
```

```json
{
  "mcpServers": {
    "hostinger": {
      "httpUrl": "https://mcp.hostinger.com",
      "headers": { "Authorization": "Bearer <jeton>" }
    }
  }
}
```

Le jeton se trouve alors en clair dans ce fichier : le protéger (droits `600`) et ne jamais le versionner. Le format exact de l'en-tête attendu par Hostinger n'est pas documenté, l'OAuth reste la voie recommandée.

Invite à donner à Gemini CLI :

```text
Déploie LorIAx sur un VPS Hostinger avec le serveur MCP Hostinger. Crée un VPS Ubuntu avec Docker (8 Go de RAM),
connecte-toi en SSH, clone le dépôt (git clone https://github.com/Flavien-Dragamig/lorIAx-oss.git),
lance LORIAX_URL=https://<domaine> bash install.sh depuis la racine du dépôt, installe un reverse proxy HTTPS
pour mon domaine <domaine> devant http://127.0.0.1:3000, crée l'enregistrement DNS et vérifie /api/health.
Ne m'affiche aucun secret, sauf la clé d'installation de /setup.
```

</details>

<details>
<summary><strong>Avec Codex CLI (OpenAI)</strong></summary>

Brancher le serveur MCP distant Hostinger (`https://mcp.hostinger.com`) dans Codex CLI.

Par OAuth, déclarer le serveur dans `~/.codex/config.toml` puis s'authentifier :

```toml
[mcp_servers.hostinger]
url = "https://mcp.hostinger.com"
```

```bash
codex mcp login hostinger
```

Sans navigateur local : `codex mcp login hostinger --no-browser`, ouvrir l'adresse affichée, puis coller l'URL de redirection complète dans le terminal.

Par jeton d'API (créé dans hPanel, rubrique API) : le placer dans une variable d'environnement, jamais dans le fichier.

```toml
[mcp_servers.hostinger]
url = "https://mcp.hostinger.com"
bearer_token_env_var = "HOSTINGER_API_TOKEN"
```

```bash
export HOSTINGER_API_TOKEN=<jeton>
```

Codex envoie la valeur dans l'en-tête `Authorization: Bearer`. Que Hostinger accepte ce format n'est pas documenté, l'OAuth reste la voie recommandée.

Invite à donner à Codex :

```text
Déploie LorIAx sur un VPS Hostinger avec le serveur MCP Hostinger. Crée un VPS Ubuntu avec Docker (8 Go de RAM),
connecte-toi en SSH, clone le dépôt (git clone https://github.com/Flavien-Dragamig/lorIAx-oss.git),
lance LORIAX_URL=https://<domaine> bash install.sh depuis la racine du dépôt, installe un reverse proxy HTTPS
pour mon domaine <domaine> devant http://127.0.0.1:3000, crée l'enregistrement DNS et vérifie /api/health.
Ne m'affiche aucun secret, sauf la clé d'installation de /setup.
```

</details>

---

## Fonctionnalités

### Éditeur de documents

Éditeur WYSIWYG complet. Taper `/` insère n'importe quel type de contenu.

- Mise en forme riche : gras, italique, listes, code, citations, encadrés
- Wiki-links (`[[`) pour relier les documents entre eux
- @mentions pour citer un collaborateur
- Glisser-déposer pour réorganiser les blocs
- Sauvegarde automatique et historique des versions

### Blocs avancés

| Bloc | Description |
|------|-------------|
| **Graphiques** | Barres, courbes, aires, camembert, avec import CSV et connecteurs de données |
| **Bases de données** | Tableaux interactifs : vues tableau, kanban, galerie ; colonnes texte, nombre, date, sélection, relation, pièces jointes, formule ; synchronisation Airtable et Notion |
| **Bloc synchronisé** | Référence vivante d'un autre document, entier ou limité à une section, en lecture seule |
| **Base liée** | Base existante affichée en lecture seule, avec tri et filtres propres au document |
| **Tableur** | Feuilles de calcul avec formules et graphiques intégrés |
| **Tableau blanc** | Canvas infini : formes, flèches, texte, bibliothèques d'icônes et de schémas |
| **Design** | Maquettes avec plans de travail ordinateur, tablette et mobile, export PNG |
| **Carte mentale** | Nœuds, sous-nœuds, raccourcis clavier, export SVG |
| **Carte interactive** | Marqueurs géolocalisés, itinéraires voiture, vélo et piéton, géocodage OpenStreetMap |
| **Calendrier** | Mini-calendrier intégré au document |
| **Vidéo intégrée** | Lecteur YouTube, Vimeo ou Dailymotion, converti automatiquement au collage du lien |
| **Réunion présentielle** | Dictaphone avec transcription et identification des locuteurs |

### Organisation

- **Espaces** personnels, d'équipe et d'organisation
- **Dossiers** imbriqués, réorganisables par glisser-déposer
- **Modèles** de documents prêts à remplir, et création d'un modèle depuis n'importe quel document
- **Étiquettes** colorées et filtrables, globales ou propres à un espace
- **Favoris** en grille réorganisable
- **Barre latérale** redimensionnable, avec sections repliables et filtre instantané

### Bases (`/bases`)

- Groupes de tables, vues grille, kanban, galerie, calendrier, formulaire et tableau de bord
- Formulaire public par lien opaque, protégé contre les robots et limité en débit
- Automatisations : déclencheurs sur création, modification, suppression de ligne ou planification ; actions webhook, notification, création ou modification de ligne
- Export CSV et XLSX
- Création de base et aide aux formules assistées par IA, quand un fournisseur d'IA est configuré

### Recherche et intelligence artificielle

- **Recherche hybride** : texte intégral, sémantique (pgvector), filtrage par espace
- **Question IA** : questions en langage naturel sur vos documents
- **Chat IA** : assistant conversationnel
- **Assistant d'aide** : réponses aux questions d'usage à partir des [fiches d'aide](docs/kb/00-bienvenue.md) livrées avec l'application
- **Résumé automatique** de documents
- Fournisseurs au choix : Claude, OpenAI, Mistral, ou Ollama pour une IA locale
- Modèle configurable par fonction (chat, aide, résumés, embeddings), avec réindexation à la demande

### Collaboration en temps réel

- **Édition simultanée** avec curseurs colorés
- **Barre de présence** : avatars des collaborateurs connectés
- **Commentaires** en fils de discussion, avec résolution
- **Mode hors-ligne** : les modifications se synchronisent au retour du réseau

### Calendrier partagé

- Vues mois, semaine, jour, agenda et Gantt
- Événements récurrents, participants, rappels
- Compatible CalDAV (Thunderbird, Apple Calendar, DAVx5)
- Import et export iCal (.ics), abonnement à des calendriers externes

### Salles de réunion

- Fiches salles : adresse, étage, capacité, équipement, photo et plan
- Horaires d'ouverture avec jours fériés français
- Droits par utilisateur, par équipe et par rôle
- Réservation validée automatiquement, sans chevauchement possible
- Tableau d'occupation et export CSV

Détail du module : [docs/meeting-rooms.md](docs/meeting-rooms.md).

### Visioconférence et transcription

- Visioconférence WebRTC (LiveKit), invités sans compte
- Enregistrement audio et transcription automatique
- Résumé de la réunion rédigé par l'IA dans un document de l'espace

Mise en place : [docs/livekit-integration.md](docs/livekit-integration.md).

### Autres modules

- **Médiathèque** : images, PDF et fichiers classés en dossiers et tags ([fiche](docs/kb/10-mediatheque.md))
- **CRM** : contacts, dossiers et interactions portés par des bases ordinaires ([fiche](docs/kb/11-crm.md))
- **Studio design** : visuels sur canvas, formats réseaux sociaux, exports PNG, SVG et PDF ([fiche](docs/kb/05-studio-design.md))
- **Graphe de connaissances** : documents et liens en graphe interactif, liens entrants de chaque document
- **Notes vocales** et **présentations**

### Sécurité et permissions

Chaque document porte un niveau de classification.

| Niveau | Usage |
|--------|-------|
| Public | Contenu partageable à l'extérieur |
| Interne | Visible par tous les membres de l'organisation |
| Confidentiel | Réservé aux membres de l'espace |
| Secret | Auteur et administrateurs uniquement |

- Partage externe par lien public, pour les documents publics seulement
- Authentification locale, LDAP ou Active Directory
- Secrets chiffrés en base (AES-256-GCM), protection SSRF, journal d'audit, CSP avec nonce

### Rôles et droits

| Rôle | Création d'utilisateurs | Gestion des rôles | Administration de l'organisation | Administration de l'instance | Salles de réunion |
|------|------------------------|-------------------|----------------------------------|------------------------------|-------------------|
| **Super administrateur** | Oui, tous les rôles | Oui | Oui | Oui | Oui |
| **Administrateur** | Oui, jusqu'à administrateur | Non | Oui | Non | Oui |
| **Gestionnaire de salles** | Non | Non | Non | Non | Oui |
| **Éditeur** | Non | Non | Non | Non | Non |
| **Lecteur** | Non | Non | Non | Non | Non |

Les réglages d'infrastructure sont réservés au super administrateur : sauvegardes et restauration, messagerie, annuaire LDAP, clés LiveKit, moteurs de transcription, fournisseurs d'IA de l'instance. Chaque espace a en plus ses propres rôles (lecteur, éditeur, administrateur d'espace), accordés à une personne ou à une équipe.

**Organisation unique par défaut** : l'instance fonctionne avec une seule organisation, créée à l'initialisation de la base. Tous les utilisateurs, espaces et réglages lui sont rattachés, sans sous-domaine ni réglage supplémentaire.

### API et intégrations

- **API REST v1** avec pagination par curseur
- **Clés d'API** (`lrx_...`) à périmètres granulaires
- **Webhooks** signés en HMAC-SHA256
- **Connecteurs de données** : API REST, Google Sheets, Airtable, Notion

### Personnalisation

- Thème sombre, clair ou automatique
- Couleur d'accentuation, police, largeur et espacement de l'éditeur
- Préréglages d'apparence, y compris par espace

Le détail des fonctions par epic se trouve dans [docs/user-stories.md](docs/user-stories.md).

## Architecture

```text
                Navigateur (PWA, mode hors-ligne)
                          │ HTTPS et WebSocket
                          ▼
              Reverse proxy (Caddy, Nginx, Traefik)
                          │ 127.0.0.1:3000
                          ▼
┌──────────────────────────────────────────────────────────┐
│ app : serveur Node (server.ts)                           │
│   Next.js (pages et API REST)                            │
│   WebSocket de collaboration Yjs (/ws/collab)            │
└──────┬───────────────┬───────────────┬───────────────────┘
       ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌──────────────────────────┐
│ postgres    │ │ garage      │ │ Options                  │
│ PostgreSQL  │ │ stockage S3 │ │ ollama (IA locale)       │
│ + pgvector  │ │ des fichiers│ │ livekit, whisper (visio) │
└──────┬──────┘ └─────────────┘ └──────────────────────────┘
       ▼
┌─────────────┐
│ backup      │  pg_dump quotidien, conservé 7 jours
└─────────────┘
```

Les documents sont en plus versionnés sur disque dans le volume `workspaces_data`.

## Stack technique et dépendances

| Catégorie | Technologie |
|-----------|-------------|
| Framework | Next.js 16, React 19, TypeScript |
| Interface | Tailwind CSS 4, shadcn/ui (Base UI) |
| Éditeur | TipTap 3 (ProseMirror) |
| Base de données | PostgreSQL 16 avec pgvector, Drizzle ORM |
| Authentification | NextAuth v5, RBAC, LDAP |
| Collaboration | Yjs et Hocuspocus (CRDT temps réel) |
| IA | Vercel AI SDK : Claude, OpenAI, Mistral, Ollama |
| Stockage | Garage (compatible S3) |
| Versions des documents | isomorphic-git |
| Graphe | D3.js |
| Graphiques | Recharts |
| Tableur | Univer |
| Tableau blanc | Excalidraw |
| Carte | Leaflet, OSRM |
| Calendrier | ical.js, rrule, CalDAV (RFC 4791) |
| Visioconférence | LiveKit (WebRTC) |
| Transcription | Faster-Whisper (Speaches), Voxtral en option |
| E-mail | Nodemailer (SMTP), Resend |
| Tests | Vitest |
| Déploiement | Docker Compose |

La licence de chaque dépendance est recensée dans [NOTICE.md](NOTICE.md).

## Démarrage rapide

Pour travailler sur le code. Pour installer une instance, voir [Lancement rapide](#lancement-rapide).

### Prérequis

- Node.js 20 ou plus récent (l'image Docker utilise Node.js 22)
- Docker et Docker Compose v2
- 8 Go de RAM pour `npm run build`

### Installation

```bash
git clone https://github.com/Flavien-Dragamig/lorIAx-oss.git
cd lorIAx-oss
npm ci --legacy-peer-deps
npm run test -- --run
npm run lint
```

`npm run dev` lance le serveur de développement (Next.js et WebSocket de collaboration) et lit ses variables dans `.env.local`. Il lui faut un PostgreSQL 16 avec pgvector et un stockage Garage joignables depuis la machine : `docker-compose.yml` ne publie pas PostgreSQL, et ne publie Garage que sur `127.0.0.1:3900`. Dans `.env.local`, `DATABASE_URL` et `S3_ENDPOINT` doivent donc viser des adresses joignables hors conteneur, pas les noms de service `postgres` et `garage`.

## Configuration

`.env.example` liste toutes les variables lues par l'application, avec leur caractère obligatoire ou facultatif. `scripts/generate-env.sh` produit un `.env` complet avec des secrets aléatoires.

| Variable | Rôle |
|----------|------|
| `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` | Adresse publique de l'instance |
| `NEXTAUTH_SECRET` | Signature des sessions |
| `ENCRYPTION_KEY` | Chiffrement en base des clés de fournisseurs d'IA, du mot de passe LDAP, etc. |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | Base de données |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | Stockage objet Garage |
| `CRON_SECRET` | Secret des appels aux routes `/api/cron` |
| `SETUP_BOOTSTRAP_TOKEN` | Clé d'installation de l'assistant `/setup` |
| `S3_PUBLIC_URL`, `WS_URL` | Adresses publiques du stockage et du WebSocket, pour la CSP |
| `TRUSTED_PROXY_COUNT` | Nombre de reverse proxies de confiance devant l'application (1 par défaut) |
| `DEFAULT_AI_PROVIDER`, `DEFAULT_AI_MODEL` | Fournisseur et modèle d'IA par défaut |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY` | Clés des fournisseurs d'IA, configurables aussi dans l'administration |
| `LIVEKIT_ENABLED`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Visioconférence |
| `WHISPER_ENABLED`, `VOXTRAL_ENABLED` | Transcription des réunions |

> Ne jamais versionner un `.env` rempli. Seul `.env.example` est suivi par git.

## Déploiement

### Docker Compose

`docker-compose.yml` démarre l'application, PostgreSQL, Garage et la sauvegarde quotidienne. L'installation complète est décrite dans [Lancement rapide](#lancement-rapide).

```bash
docker compose up -d --build        # construire et démarrer
docker compose logs -f app          # suivre les journaux
docker compose ps                   # état des services
docker compose down                 # arrêter (les volumes sont conservés)
```

Seuls deux ports sont publiés, sur la machine uniquement : `127.0.0.1:3000` (application et WebSocket de collaboration) et `127.0.0.1:3900` (API S3 de Garage). Pour que le navigateur charge les fichiers par une adresse dédiée, exposer `127.0.0.1:3900` par le reverse proxy et renseigner `S3_PUBLIC_URL` ; `WS_URL` déclare l'adresse WebSocket publique. Les deux variables alimentent la CSP.

### Options

<details>
<summary><strong>IA locale avec Ollama</strong></summary>

```bash
docker compose --profile ollama up -d
docker compose --profile ollama exec ollama ollama pull gemma4:e4b
```

`gemma4:e4b` est le modèle par défaut écrit par `scripts/generate-env.sh` (`DEFAULT_AI_MODEL`). Le service `ollama` est plafonné à 8 Go de mémoire.

</details>

<details>
<summary><strong>Visioconférence, enregistrement et transcription</strong></summary>

Sur une instance neuve : `bash install.sh --livekit`. Sur une instance existante, renseigner dans `.env` :

```text
LIVEKIT_ENABLED=true
LIVEKIT_URL=wss://visio.exemple.fr
WHISPER_ENABLED=true
```

puis démarrer avec les deux fichiers :

```bash
docker compose -f docker-compose.yml -f docker-compose.livekit.yml up -d --build
```

`WHISPER_ENABLED=true` est facultatif et active la transcription. `LIVEKIT_API_KEY` et `LIVEKIT_API_SECRET` sont déjà générés par `scripts/generate-env.sh`. Ports à ouvrir sur le pare-feu : 7881/tcp et 50000-50050/udp pour le média WebRTC. La signalisation écoute sur `127.0.0.1:7880` et se place derrière le reverse proxy, à l'adresse donnée dans `LIVEKIT_URL`. La transcription par GPU (Voxtral, carte NVIDIA de 16 Go de mémoire vidéo au minimum) s'ajoute avec `--profile voxtral` et `VOXTRAL_ENABLED=true`.

Détail : [docs/livekit-integration.md](docs/livekit-integration.md).

</details>

<details>
<summary><strong>Sauvegardes</strong></summary>

Le service `backup` écrit chaque jour un `pg_dump` de la base dans le volume `backup_data` et supprime les fichiers de plus de 7 jours.

```bash
docker compose exec backup ls -lh /backups
docker compose exec -T postgres pg_dump -U loriax -Fc loriax > sauvegarde.dump
```

La seconde commande produit une sauvegarde immédiate sur la machine. Les fichiers téléversés (volumes `garage_data` et `garage_meta`) et les versions des documents (volume `workspaces_data`) ne sont pas couverts par ce service : les sauvegarder avec l'outil de sauvegarde du serveur.

</details>

### Mise à jour

```bash
# 1. Sauvegarder la base
docker compose exec -T postgres pg_dump -U loriax -Fc loriax > sauvegarde-avant-mise-a-jour.dump

# 2. Récupérer la nouvelle version
git pull

# 3. Reconstruire et redémarrer
docker compose up -d --build
```

Le service `app-migrate` rapproche la base du nouveau schéma avant chaque démarrage de l'application : il applique les différences de schéma, crée les colonnes vectorielles, les déclencheurs et l'organisation par défaut, puis inscrit la migration initiale comme déjà appliquée. En cas d'échec, l'application ne démarre pas : `docker compose logs app-migrate`.

**Depuis une version 1.21.x** : les volumes Docker portent les mêmes noms et le `.env` existant se conserve (ne pas le régénérer). Lui ajouter avant l'étape 3 le secret des tâches planifiées, exigé par `docker-compose.yml` :

```bash
echo "CRON_SECRET=$(openssl rand -hex 32)" >> .env
```

Les variantes de fichier compose des versions 1.21.x (production, client, registre) n'existent plus : tout passe par `docker-compose.yml`. Les changements incompatibles sont détaillés dans [CHANGELOG.md](CHANGELOG.md).

### Sans Docker

<details>
<summary><strong>Construire et lancer le serveur Node directement</strong></summary>

`npm start` exécute `node server.js`. Ce fichier n'existe pas dans le dépôt : il est produit en assemblant `server.ts` avec esbuild, après `npm run build`. Les commandes ci-dessous reprennent celles du `Dockerfile`.

```bash
npm ci --legacy-peer-deps
NEXT_PUBLIC_APP_URL=https://wiki.exemple.fr npm run build
node_modules/.bin/esbuild server.ts \
  --bundle --platform=node --target=node22 --packages=external \
  --alias:server-only=./esbuild-stubs/server-only.js \
  --outfile=.next/standalone/server.js --tsconfig=tsconfig.json
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r src/lib/db/migrations .next/standalone/migrations
mkdir -p .next/standalone/docs && cp -r docs/kb .next/standalone/docs/kb
npx tsx --env-file=.env scripts/init-db.ts
cd .next/standalone
NODE_ENV=production node --env-file=../../.env server.js
```

`scripts/init-db.ts` prépare la base (schéma, extensions, organisation par défaut) : le lancer avant `npm start` à la première installation et à chaque mise à jour.

Le serveur écoute sur le port 3000 (`PORT`). Il attend un PostgreSQL 16 avec les extensions `vector`, `pg_trgm`, `pgcrypto` et `btree_gist`, et un stockage compatible S3 ; `DATABASE_URL` et `S3_ENDPOINT` du `.env` doivent viser des adresses joignables depuis la machine. Le rendu des designs côté serveur demande en plus les bibliothèques système Cairo, Pango, libjpeg, giflib, librsvg et Pixman.

</details>

## Scripts npm

| Commande | Effet |
|----------|-------|
| `npm run dev` | Serveur de développement (Next.js et WebSocket), variables lues dans `.env.local` |
| `npm run build` | Construction de production (`next build`) |
| `npm start` | `node server.js`, après la construction décrite dans [Sans Docker](#sans-docker) |
| `npm run test` | Tests unitaires (Vitest) |
| `npm run lint` | ESLint |
| `npm run i18n:check` | Contrôle des traductions |
| `npm run db:generate` | Génère une migration Drizzle depuis le schéma |
| `npm run db:studio` | Explorateur de base Drizzle |
| `npm run kb:index` | Indexe les fiches d'aide de `docs/kb` |

## Structure du projet

```text
.
├── src/
│   ├── app/            # Routes Next.js : pages et API REST
│   ├── components/     # Composants React (éditeur, graphe, barre latérale, IA)
│   ├── lib/            # Logique métier : base, authentification, IA, stockage, collaboration
│   ├── hooks/          # Hooks React
│   └── types/          # Types TypeScript
├── scripts/            # Génération du .env, initialisation de la base, jeux de données
├── docker/             # Configuration de PostgreSQL, Garage, LiveKit et Voxtral
├── docs/               # Fiches d'aide (docs/kb) et documentation des modules
├── public/             # Fichiers statiques
├── server.ts           # Serveur Node : Next.js, WebSocket, migrations au démarrage
├── Dockerfile
├── docker-compose.yml
├── docker-compose.livekit.yml
└── install.sh
```

## Tests et qualité

```bash
npm run test -- --run     # suite Vitest, une seule passe
npm run lint              # ESLint
npx tsc --noEmit          # contrôle des types
```

## Documentation

| Document | Contenu |
|----------|---------|
| [Fiches d'aide](docs/kb/00-bienvenue.md) | Prise en main, éditeur, bases, recherche, IA, calendrier, rôles, dépannage |
| [Fonctions par epic](docs/user-stories.md) | Fonctionnalités détaillées |
| [Salles de réunion](docs/meeting-rooms.md) | Module de réservation de salles |
| [Visioconférence](docs/livekit-integration.md) | Intégration LiveKit |
| [Conventions de traduction](docs/i18n-conventions.md) | Règles i18n, avec le [glossaire](docs/i18n-glossary.md) |
| [Conflits de dépendances](docs/peer-deps-conflicts.md) | Raison de l'option `--legacy-peer-deps` |
| [Composants tiers](NOTICE.md) | Dépendances et leurs licences |

## Contribuer

Les règles de contribution sont dans [CONTRIBUTING.md](CONTRIBUTING.md), le code de conduite dans [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Les anomalies et les demandes se déposent dans les [issues GitHub](https://github.com/Flavien-Dragamig/lorIAx-oss/issues).

## Sécurité

Une faille se signale en privé à `security@dragamig.fr`, jamais dans une issue publique. La politique complète et les versions prises en charge sont dans [SECURITY.md](SECURITY.md).

## Changelog

L'historique des versions est dans [CHANGELOG.md](CHANGELOG.md). Le projet suit le versionnement sémantique et les Conventional Commits.

## À propos

Les choix d'architecture, la relecture et la validation du code sont humains ; l'assistance de [Claude](https://claude.com/product/overview), le modèle d'[Anthropic](https://www.anthropic.com), a servi à l'écriture du code et de la documentation.

## Remerciements

- [VizHash GD](https://sebsauvage.net/wiki/doku.php?id=php:vizhash_gd) de sebsauvage, dont les avatars déterministes de LorIAx sont un portage TypeScript
- [Garage](https://garagehq.deuxfleurs.fr/) de l'association Deuxfleurs, pour le stockage objet
- Les contributeurs d'[OpenStreetMap](https://www.openstreetmap.org/copyright) et le projet [OSRM](https://project-osrm.org/), pour le géocodage et les itinéraires
- Les mainteneurs de Next.js, TipTap, Yjs, Hocuspocus, Drizzle, Excalidraw, Univer, LiveKit et des autres projets recensés dans [NOTICE.md](NOTICE.md)

## Licence

[FSL-1.1-MIT](LICENSE) (Functional Source License 1.1, licence future MIT). Le titulaire des droits est indiqué dans [LICENSE](LICENSE).

Le code peut être utilisé, modifié et redistribué pour tout usage, sauf pour proposer un produit ou un service concurrent. Chaque version passe sous licence MIT deux ans après sa publication. Le logiciel est fourni sans garantie.

Les versions 1.21.0 et 1.21.1 ont été publiées sous licence MIT et le restent : voir le tag [`v1.21.1`](https://github.com/Flavien-Dragamig/lorIAx-oss/tree/v1.21.1).

---

<div align="center">

Créé par Studio Dragamig avec l'aide de Claude d'Anthropic

</div>
