#!/bin/bash
# ============================================================
# LorIAx : recette d'installation Docker
#
# Prouve, sur une copie jetable du dépôt :
#   1. une installation neuve par install.sh (santé, page de connexion, mention IA) ;
#   2. le parcours de configuration (clé d'installation, administrateur, connexion,
#      document, base, automatisation, présentation, design, modules, routes supprimées) ;
#   3. le démarrage sans clés IA, S3 distant ni LiveKit (modules désactivés, aucune erreur 500) ;
#   4. la mise à jour d'une base issue d'une version 1.21.x vers cette version, sur le même volume
#      (document et pièce jointe déposée par l'API de l'ancienne version, relus après mise à jour).
#
# Usage : bash scripts/smoke-install.sh [options]
#   --repo DIR       dépôt à tester (défaut : dossier parent de ce script s'il contient docker-compose.yml ;
#                    obligatoire depuis l'application privée, où le script est lancé via oss/scripts/)
#   --old-tag TAG    étiquette 1.21.x de départ pour la mise à jour (défaut : dernière v1.21.*)
#   --project NAME   nom du projet Docker Compose (défaut : loriax-smoke)
#   --skip-upgrade   ne pas jouer l'étape de mise à jour
#   --keep           ne pas supprimer conteneurs, volumes et dossiers à la fin
#   --report FILE    fichier du rapport (défaut : <tmp>/<projet>-report.txt)
#
# Prérequis : docker compose v2, git, curl, jq, openssl. L'application écoute sur
# 127.0.0.1:3000 et Garage sur 127.0.0.1:3900 (ports fixés par docker-compose.yml) :
# libérez-les avant de lancer. Plusieurs minutes de construction d'image à chaque étape.
# Code de sortie : 0 si toutes les étapes réussissent, 1 sinon.
# ============================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
OLD_TAG=""
PROJECT="loriax-smoke"
SKIP_UPGRADE=false
KEEP=false
REPORT=""

while [ $# -gt 0 ]; do
    case "$1" in
        --repo) REPO="$(cd "$2" && pwd)"; shift 2 ;;
        --old-tag) OLD_TAG="$2"; shift 2 ;;
        --project) PROJECT="$2"; shift 2 ;;
        --skip-upgrade) SKIP_UPGRADE=true; shift ;;
        --keep) KEEP=true; shift ;;
        --report) REPORT="$2"; shift 2 ;;
        *) echo "Option inconnue : $1" >&2; exit 2 ;;
    esac
done

for bin in docker git curl jq openssl; do
    command -v "$bin" >/dev/null 2>&1 || { echo "$bin est requis." >&2; exit 2; }
done
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 requis." >&2; exit 2; }
[ -f "$REPO/docker-compose.yml" ] || { echo "docker-compose.yml introuvable dans $REPO : indiquer le dépôt à tester avec --repo DIR" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/loriax-smoke.XXXXXX")"
REPORT="${REPORT:-${TMPDIR:-/tmp}/${PROJECT}-report.txt}"
NEW_DIR="$WORK/new"
OLD_DIR="$WORK/old"
BASE="http://127.0.0.1:3000"
JAR="$WORK/cookies.txt"
BODY="$WORK/body.json"
AI_MENTION="Créé par Studio Dragamig avec l'aide de Claude d'Anthropic"
ADMIN_EMAIL="admin@smoke.test"
ADMIN_PASSWORD="Smoke-Install-2026-xyz"
export COMPOSE_PROJECT_NAME="$PROJECT"

FAILED=0
CODE=""

dc() {
    if [ "$CURRENT_DIR" = "$OLD_DIR" ]; then
        (cd "$CURRENT_DIR" && docker compose -f docker-compose.yml -f docker-compose.smoke-old.yml "$@")
    else
        (cd "$CURRENT_DIR" && docker compose "$@")
    fi
}
CURRENT_DIR="$NEW_DIR"

now() { date +%s; }

# record "étape" "OK|ECHEC" "détail" début
record() {
    local name="$1" result="$2" detail="$3" start="$4"
    local dur=$(( $(now) - start ))
    printf '%-52s %-6s %5ss  %s\n' "$name" "$result" "$dur" "$detail" | tee -a "$REPORT"
    [ "$result" = "OK" ] || FAILED=1
}

# step "nom" fonction : la fonction renvoie 0 et peut écrire un détail dans $DETAIL
DETAIL=""
step() {
    local name="$1"; shift
    local start; start="$(now)"
    DETAIL=""
    if "$@"; then record "$name" "OK" "$DETAIL" "$start"; return 0; fi
    record "$name" "ECHEC" "$DETAIL" "$start"
    return 1
}

# api METHOD CHEMIN [JSON] [en-têtes...] : code HTTP dans $CODE, corps dans $BODY
api() {
    local method="$1" path="$2" data="${3:-}"; shift 3 2>/dev/null || shift $#
    local args=(-sS -o "$BODY" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR" -H "Origin: $BASE")
    [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
    local h
    for h in "$@"; do args+=(-H "$h"); done
    CODE="$(curl "${args[@]}" "$BASE$path" 2>&1)" || CODE="000"
}

cleanup() {
    local rc=$?
    if [ "$KEEP" = true ]; then
        echo "Dossier de travail conservé : $WORK (projet Docker : $PROJECT)"
        exit $rc
    fi
    for d in "$NEW_DIR" "$OLD_DIR"; do
        [ -d "$d" ] && (cd "$d" && docker compose -p "$PROJECT" down -v --rmi local --remove-orphans >/dev/null 2>&1)
    done
    docker compose -p "$PROJECT" down -v --remove-orphans >/dev/null 2>&1
    rm -rf "$WORK"
    exit $rc
}
trap cleanup EXIT

# --- Utilitaires ---

port_free() { ! (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -qE "[:.]$1[[:space:]]"; }

wait_health() {
    local tries="${1:-90}" i
    for i in $(seq 1 "$tries"); do
        api GET /api/health
        [ "$CODE" = "200" ] && return 0
        sleep 5
    done
    DETAIL="/api/health : dernier code $CODE"
    return 1
}

env_value() { grep -E "^$1=" "$2" | head -n 1 | cut -d= -f2-; }

login() {
    : > "$JAR"
    api GET /api/auth/csrf
    local csrf; csrf="$(jq -r '.csrfToken' "$BODY")"
    local code
    code="$(curl -sS -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR" -H "Origin: $BASE" \
        --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$ADMIN_EMAIL" \
        --data-urlencode "password=$ADMIN_PASSWORD" --data-urlencode "json=true" \
        "$BASE/api/auth/callback/credentials")"
    api GET /api/auth/whoami
    if [ "$CODE" != "200" ]; then DETAIL="connexion refusée (callback $code, whoami $CODE)"; return 1; fi
    return 0
}

# --- Étape 1 : installation neuve ---

s_clone_install() {
    port_free 3000 || { DETAIL="le port 3000 est occupé"; return 1; }
    port_free 3900 || { DETAIL="le port 3900 est occupé"; return 1; }
    git clone -q --local --no-hardlinks "$REPO" "$NEW_DIR" || { DETAIL="clone impossible"; return 1; }
    # Le dépôt testé est la copie commitée : les fichiers de travail non suivis ne comptent pas.
    CURRENT_DIR="$NEW_DIR"
    (cd "$NEW_DIR" && LORIAX_URL="$BASE" bash install.sh > "$WORK/install.log" 2>&1) \
        || { DETAIL="install.sh a échoué, voir $WORK/install.log"; tail -n 20 "$WORK/install.log" >&2; return 1; }
    [ -f "$NEW_DIR/.env" ] || { DETAIL=".env absent"; return 1; }
    return 0
}

s_health() { wait_health 90; }

s_login_page() {
    local code
    code="$(curl -sS -L -o "$BODY" -w '%{http_code}' "$BASE/login")"
    [ "$code" = "200" ] || { DETAIL="page de connexion : code $code"; return 1; }
    grep -qF "$AI_MENTION" "$BODY" || { DETAIL="mention IA absente de la page de connexion"; return 1; }
    DETAIL="mention IA présente"
    return 0
}

# --- Étape 2 : parcours de configuration ---

SETUP_TOKEN=""
s_setup() {
    SETUP_TOKEN="$(env_value SETUP_BOOTSTRAP_TOKEN "$NEW_DIR/.env")"
    [ -n "$SETUP_TOKEN" ] || { DETAIL="clé d'installation absente du .env"; return 1; }
    local h="x-setup-token: $SETUP_TOKEN"
    api POST /api/setup/authorize "$(jq -nc --arg t "$SETUP_TOKEN" '{token:$t}')"
    [ "$CODE" = "200" ] || { DETAIL="authorize : $CODE"; return 1; }
    api POST /api/setup/authorize '{"token":"mauvaise-cle"}'
    [ "$CODE" != "200" ] || { DETAIL="authorize accepte une mauvaise clé"; return 1; }
    api POST /api/setup/identity '{"name":"Smoke Org","description":"recette"}' "$h"
    [ "$CODE" = "200" ] || { DETAIL="identity : $CODE $(cat "$BODY")"; return 1; }
    api POST /api/setup/users "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" \
        '{users:[{name:"Admin Smoke",email:$e,role:"super_admin",password:$p}]}')" "$h"
    [ "$CODE" = "200" ] || { DETAIL="users : $CODE $(cat "$BODY")"; return 1; }
    api POST /api/setup/complete '{}' "$h"
    [ "$CODE" = "200" ] || { DETAIL="complete : $CODE $(cat "$BODY")"; return 1; }
    # Une fois l'assistant terminé, la clé ne doit plus servir.
    api POST /api/setup/users '{"users":[]}' "$h"
    [ "$CODE" = "403" ] || [ "$CODE" = "401" ] || { DETAIL="setup encore ouvert après complete : $CODE"; return 1; }
    return 0
}

s_login() { login; }

SPACE_ID=""
SPACE_SLUG=""
s_space() {
    api GET /api/spaces
    [ "$CODE" = "200" ] || { DETAIL="spaces : $CODE"; return 1; }
    SPACE_ID="$(jq -r '[.[] | select(.type=="personal")][0].id // .[0].id // empty' "$BODY")"
    SPACE_SLUG="$(jq -r '[.[] | select(.type=="personal")][0].slug // .[0].slug // empty' "$BODY")"
    [ -n "$SPACE_ID" ] || { DETAIL="aucun espace"; return 1; }
    DETAIL="espace $SPACE_SLUG"
    return 0
}

DOC_ID=""
s_document() {
    api POST "/api/spaces/$SPACE_SLUG/documents" '{"title":"Document de recette","content":"# Recette\n\nTexte de contrôle."}'
    [ "$CODE" = "201" ] || [ "$CODE" = "200" ] || { DETAIL="document : $CODE $(head -c 200 "$BODY")"; return 1; }
    DOC_ID="$(jq -r '.id // empty' "$BODY")"
    [ -n "$DOC_ID" ] || { DETAIL="identifiant de document absent"; return 1; }
    api GET "/api/documents/$DOC_ID"
    [ "$CODE" = "200" ] || { DETAIL="lecture du document : $CODE"; return 1; }
    return 0
}

s_database() {
    api POST /api/databases "$(jq -nc --arg s "$SPACE_ID" '{name:"Base de recette",spaceId:$s}')"
    [ "$CODE" = "201" ] || [ "$CODE" = "200" ] || { DETAIL="base : $CODE $(head -c 200 "$BODY")"; return 1; }
    return 0
}

s_automation() {
    api POST /api/automations "$(jq -nc --arg s "$SPACE_ID" \
        '{spaceId:$s,name:"Automatisation de recette",triggerType:"manual",actionType:"create_task",actionConfig:{title:"Tâche de recette"}}')"
    [ "$CODE" = "201" ] || [ "$CODE" = "200" ] || { DETAIL="automatisation : $CODE $(head -c 300 "$BODY")"; return 1; }
    return 0
}

s_presentation() {
    api POST /api/presentations "$(jq -nc --arg s "$SPACE_ID" '{spaceId:$s,title:"Présentation de recette"}')"
    [ "$CODE" = "201" ] || [ "$CODE" = "200" ] || { DETAIL="présentation : $CODE $(head -c 200 "$BODY")"; return 1; }
    return 0
}

s_design() {
    local id; id="$(cat /proc/sys/kernel/random/uuid)"
    api PUT "/api/designs/$id?documentId=$DOC_ID" '{"elements":[],"appState":{}}'
    [ "$CODE" = "200" ] || { DETAIL="design PUT : $CODE $(head -c 200 "$BODY")"; return 1; }
    api GET "/api/designs/$id?documentId=$DOC_ID"
    [ "$CODE" = "200" ] || { DETAIL="design GET : $CODE"; return 1; }
    return 0
}

s_modules() {
    api GET /api/admin/modules
    [ "$CODE" = "200" ] || { DETAIL="modules : $CODE"; return 1; }
    cp "$BODY" "$WORK/modules.json"
    local n; n="$(jq '.modules | length' "$BODY")"
    [ "$n" -gt 0 ] || { DETAIL="aucun module listé"; return 1; }
    jq -e '[.modules[].id] | (index("studiovideo") == null and index("commercial") == null)' "$BODY" >/dev/null \
        || { DETAIL="studiovideo ou commercial présent"; return 1; }
    # Tous les modules inclus sont compilés et autorisés ; ceux dont le manifeste est actif par
    # défaut sont actifs, les autres restent coupés jusqu'à leur configuration.
    jq -e '[.modules[] | select(.compiled != true or .entitled != true)] | length == 0' "$BODY" >/dev/null \
        || { DETAIL="module non compilé ou non autorisé : $(jq -r '[.modules[] | select(.compiled != true or .entitled != true) | .id] | join(" ")' "$BODY")"; return 1; }
    jq -e '[.modules[] | select(.toggledOn == true and .missingDeps == [] and .status != "active")] | length == 0' "$BODY" >/dev/null \
        || { DETAIL="module activé par défaut mais inactif"; return 1; }
    DETAIL="$n modules : $(jq -r '[.modules[] | "\(.id)=\(.status)"] | join(" ")' "$BODY")"
    return 0
}

s_removed_routes() {
    local p
    for p in /api/billing/checkout /api/admin/licenses; do
        api GET "$p"
        [ "$CODE" = "404" ] || { DETAIL="$p répond $CODE au lieu de 404"; return 1; }
    done
    return 0
}

# --- Étape 3 : variables absentes ---

s_optional_off() {
    # Le .env généré ne porte aucune clé IA, aucun S3 distant, LiveKit coupé.
    local k
    for k in ANTHROPIC_API_KEY OPENAI_API_KEY MISTRAL_API_KEY; do
        [ -z "$(env_value "$k" "$NEW_DIR/.env")" ] || { DETAIL="$k est renseignée dans le .env"; return 1; }
    done
    [ "$(env_value LIVEKIT_ENABLED "$NEW_DIR/.env")" = "false" ] || { DETAIL="LIVEKIT_ENABLED n'est pas false"; return 1; }
    api GET /api/admin/modules
    [ "$CODE" = "200" ] || { DETAIL="modules : $CODE"; return 1; }
    local m out=""
    for m in ai livekit whisper; do
        local st; st="$(jq -r --arg m "$m" '.modules[] | select(.id==$m) | .status' "$BODY")"
        if [ -z "$st" ]; then out="$out $m=absent"; continue; fi
        case "$st" in
            active|enabled) DETAIL="module $m actif sans configuration"; return 1 ;;
        esac
        out="$out $m=$st"
    done
    DETAIL="$out"
    return 0
}

s_no_500() {
    local errs
    errs="$(dc logs --no-color app 2>&1 | grep -E '(^|[^0-9])500([^0-9]|$)|"statusCode":500|Internal Server Error' | head -n 5)"
    [ -z "$errs" ] || { DETAIL="erreur 500 dans les journaux : $(echo "$errs" | head -n 1 | cut -c1-160)"; return 1; }
    return 0
}

# --- Étape 4 : mise à jour depuis 1.21.x ---

OLD_DOC_TITLE="Document issu de 1.21"
OLD_FILE_CONTENT="Pièce jointe écrite sous 1.21, contrôle de mise à jour."
OLD_ATT_KEY=""
s_old_stack() {
    # Départs pris en charge : v1.21.0 et v1.21.1. Leurs schémas diffèrent d'un seul index
    # (idx_attachments_storage_key sur attachments, migration 0001 de 1.21.1) : le chemin de mise
    # à jour est le même. Sans --old-tag, la plus récente des étiquettes v1.21.* est utilisée.
    if [ -z "$OLD_TAG" ]; then
        OLD_TAG="$(git -C "$REPO" tag --list 'v1.21.*' | sort -V | tail -n 1)"
    fi
    [ -n "$OLD_TAG" ] || { DETAIL="aucune étiquette v1.21.* dans $REPO"; return 1; }
    # L'installation neuve est arrêtée et ses volumes supprimés : l'ancienne pile repart de zéro.
    dc down -v --remove-orphans >/dev/null 2>&1
    git clone -q --local --no-hardlinks "$REPO" "$OLD_DIR" || { DETAIL="clone impossible"; return 1; }
    (cd "$OLD_DIR" && git checkout -q "$OLD_TAG") || { DETAIL="étiquette $OLD_TAG introuvable"; return 1; }
    # Mêmes secrets pour l'ancienne et la nouvelle version : la base garde son mot de passe.
    cp "$NEW_DIR/.env" "$OLD_DIR/.env"
    cp "$NEW_DIR/.env" "$OLD_DIR/.env.local"
    # 1.21.1 impose un jeton d'installation (SETUP_INSTALL_TOKEN, 16 caractères minimum) sur
    # toutes les routes /api/setup/* ; 1.21.0 l'ignore et garde le jeton d'amorçage.
    printf '\nSETUP_INSTALL_TOKEN=%s\n' "$(env_value SETUP_BOOTSTRAP_TOKEN "$NEW_DIR/.env")" >> "$OLD_DIR/.env.local"
    # La pile de développement 1.21 publie Postgres sur 5432 : on le passe sur un port libre de
    # la boucle locale, et on ajoute l'étape app-migrate de la pile de production 1.21.
    sed -i 's|- "5432:5432"|- "127.0.0.1::5432"|; s|- "3903:3903"|- "127.0.0.1::3903"|; s|- "3900:3900"|- "127.0.0.1:3900:3900"|; s|- "3000:3000"|- "127.0.0.1:3000:3000"|' "$OLD_DIR/docker-compose.yml"
    cat > "$OLD_DIR/docker-compose.smoke-old.yml" <<'YML'
services:
  app-migrate:
    build:
      context: .
      dockerfile: Dockerfile
      target: builder
    env_file:
      - .env
    environment:
      - DATABASE_URL=postgresql://loriax:${POSTGRES_PASSWORD}@postgres:5432/loriax
    entrypoint: ["node_modules/.bin/tsx", "scripts/init-db.ts"]
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"
    networks:
      - backend
  app:
    depends_on:
      app-migrate:
        condition: service_completed_successfully
YML
    CURRENT_DIR="$OLD_DIR"
    (cd "$OLD_DIR" && docker compose -f docker-compose.yml -f docker-compose.smoke-old.yml up -d --build \
        app app-migrate postgres garage garage-init > "$WORK/old-up.log" 2>&1) \
        || { DETAIL="démarrage $OLD_TAG échoué, voir $WORK/old-up.log"; tail -n 20 "$WORK/old-up.log" >&2; return 1; }
    wait_health 90 || return 1
    DETAIL="$OLD_TAG démarrée"
    return 0
}

s_old_content() {
    # Une instance 1.21.x en service possède son organisation par défaut (la 2.0.0 la crée
    # elle-même au déploiement) : on la pose ici pour reproduire cet état de départ.
    dc exec -T postgres psql -U loriax -d loriax -q -c \
        "INSERT INTO organizations (name, slug, plan) VALUES ('LorIAx', 'default', 'community') ON CONFLICT (slug) DO NOTHING;" \
        >/dev/null 2>&1 || { DETAIL="organisation par défaut non créée"; return 1; }
    # 1.21.0 lit l'en-tête x-setup-token ; 1.21.1 lit le cookie setup_install_token (posé par
    # /api/setup/access, mais envoyé ici en clair : le cookie est Secure et la recette est en HTTP).
    local h="x-setup-token: $SETUP_TOKEN"
    local c="Cookie: setup_install_token=$SETUP_TOKEN"
    api POST /api/setup/identity '{"name":"Smoke Org","description":"recette"}' "$h" "$c"
    [ "$CODE" = "200" ] || { DETAIL="identity (1.21) : $CODE $(head -c 200 "$BODY")"; return 1; }
    api POST /api/setup/users "$(jq -nc --arg e "$ADMIN_EMAIL" --arg p "$ADMIN_PASSWORD" \
        '{users:[{name:"Admin Smoke",email:$e,role:"super_admin",password:$p}]}')" "$h" "$c"
    [ "$CODE" = "200" ] || { DETAIL="users (1.21) : $CODE $(head -c 200 "$BODY")"; return 1; }
    api POST /api/setup/complete '{}' "$h" "$c"
    [ "$CODE" = "200" ] || { DETAIL="complete (1.21) : $CODE $(head -c 200 "$BODY")"; return 1; }
    login || return 1
    s_space || return 1
    api POST "/api/spaces/$SPACE_SLUG/documents" "$(jq -nc --arg t "$OLD_DOC_TITLE" '{title:$t,content:"Contenu écrit sous 1.21."}')"
    [ "$CODE" = "201" ] || [ "$CODE" = "200" ] || { DETAIL="document (1.21) : $CODE $(head -c 200 "$BODY")"; return 1; }
    DOC_ID="$(jq -r '.id' "$BODY")"
    return 0
}

s_old_attachment() {
    # Dépôt d'un fichier dans le document par la vraie route de 1.21.x (POST /api/attachments).
    printf '%s' "$OLD_FILE_CONTENT" > "$WORK/piece-jointe.txt"
    local code
    code="$(curl -sS -o "$BODY" -w '%{http_code}' -b "$JAR" -c "$JAR" -H "Origin: $BASE" \
        -F "file=@$WORK/piece-jointe.txt;type=text/plain" -F "spaceId=$SPACE_ID" -F "documentId=$DOC_ID" \
        "$BASE/api/attachments")" || code="000"
    [ "$code" = "201" ] || { DETAIL="dépôt de la pièce jointe (1.21) : $code $(head -c 200 "$BODY")"; return 1; }
    OLD_ATT_KEY="$(jq -r '.storageKey // empty' "$BODY")"
    [ -n "$OLD_ATT_KEY" ] || { DETAIL="clé de stockage absente de la réponse"; return 1; }
    api GET "/api/attachments/$OLD_ATT_KEY"
    [ "$CODE" = "200" ] || { DETAIL="lecture de la pièce jointe sous 1.21 : $CODE"; return 1; }
    [ "$(cat "$BODY")" = "$OLD_FILE_CONTENT" ] || { DETAIL="contenu relu sous 1.21 différent"; return 1; }
    DETAIL="clé $OLD_ATT_KEY"
    return 0
}

s_old_registration() {
    # En 1.21.x, tout enregistrement de l'onglet Système stockait auth.allowRegistration = true.
    # On reproduit cet état sur la base 1.21.x : la mise à jour doit le refermer.
    local n
    n="$(dc exec -T postgres psql -U loriax -d loriax -tA -c \
        "INSERT INTO system_settings (key, value) VALUES ('auth', '{\"allowRegistration\": true}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = jsonb_set(system_settings.value, '{allowRegistration}', 'true'::jsonb) RETURNING value ->> 'allowRegistration'" 2>/dev/null | head -n 1 | tr -d '[:space:]')"
    [ "$n" = "true" ] || { DETAIL="réglage auth non posé sous 1.21 (reçu : ${n:-vide})"; return 1; }
    DETAIL="auth.allowRegistration = true stocké, comme après un enregistrement de l'onglet Système 1.21"
    return 0
}

s_upgrade() {
    # Arrêt de l'ancienne application, volumes conservés.
    dc down --remove-orphans >/dev/null 2>&1
    CURRENT_DIR="$NEW_DIR"
    cp "$OLD_DIR/.env" "$NEW_DIR/.env"
    (cd "$NEW_DIR" && docker compose up -d --build > "$WORK/upgrade-up.log" 2>&1) \
        || { DETAIL="démarrage 2.0.0 échoué, voir $WORK/upgrade-up.log"; tail -n 20 "$WORK/upgrade-up.log" >&2; return 1; }
    local cid status
    cid="$(dc ps -a -q app-migrate)"
    status="$(docker inspect -f '{{.State.ExitCode}}' "$cid" 2>/dev/null)"
    [ "$status" = "0" ] || { DETAIL="app-migrate a quitté avec $status"; return 1; }
    dc logs --no-color app-migrate > "$WORK/app-migrate.log" 2>&1
    if grep -qi "already exists" "$WORK/app-migrate.log"; then
        DETAIL="app-migrate signale already exists : $(grep -i 'already exists' "$WORK/app-migrate.log" | head -n 1 | cut -c1-160)"
        return 1
    fi
    wait_health 90 || return 1
    return 0
}

s_upgrade_read() {
    login || return 1
    api GET "/api/documents/$DOC_ID"
    [ "$CODE" = "200" ] || { DETAIL="lecture du document 1.21 : $CODE"; return 1; }
    jq -e --arg t "$OLD_DOC_TITLE" '.title == $t' "$BODY" >/dev/null || { DETAIL="titre du document différent"; return 1; }
    api GET /api/admin/modules
    [ "$CODE" = "200" ] || { DETAIL="modules après mise à jour : $CODE"; return 1; }
    return 0
}

s_upgrade_attachment() {
    api GET "/api/attachments/$OLD_ATT_KEY"
    [ "$CODE" = "200" ] || { DETAIL="pièce jointe 1.21 servie avec le code $CODE"; return 1; }
    [ "$(cat "$BODY")" = "$OLD_FILE_CONTENT" ] || { DETAIL="octets de la pièce jointe différents après mise à jour"; return 1; }
    local n
    n="$(dc exec -T postgres psql -U loriax -d loriax -tA -c \
        "SELECT count(*) FROM media WHERE storage_key = '$OLD_ATT_KEY' AND document_id = '$DOC_ID'" 2>/dev/null | tr -d '[:space:]')"
    [ "$n" = "1" ] || { DETAIL="pièce jointe absente de media ou non liée au document (lignes : ${n:-?})"; return 1; }
    DETAIL="servie (200), mêmes octets, ligne media liée au document"
    return 0
}

s_upgrade_registration_closed() {
    local v users
    v="$(dc exec -T postgres psql -U loriax -d loriax -tA -c \
        "SELECT value ->> 'allowRegistration' FROM system_settings WHERE key = 'auth'" 2>/dev/null | tr -d '[:space:]')"
    [ "$v" = "false" ] || { DETAIL="auth.allowRegistration vaut '${v:-absent}' après mise à jour, attendu false"; return 1; }
    api POST /api/auth/register '{"name":"Inscrit Recette","email":"inscrit-recette@example.org","password":"Recette-Inscription-2026!"}'
    [ "$CODE" = "403" ] || { DETAIL="POST /api/auth/register renvoie $CODE après mise à jour, attendu 403 : $(head -c 200 "$BODY")"; return 1; }
    users="$(dc exec -T postgres psql -U loriax -d loriax -tA -c \
        "SELECT count(*) FROM users WHERE email = 'inscrit-recette@example.org'" 2>/dev/null | tr -d '[:space:]')"
    [ "$users" = "0" ] || { DETAIL="un compte a été créé malgré le refus (lignes : ${users:-?})"; return 1; }
    DETAIL="réglage refermé, inscription refusée (403), aucun compte créé"
    return 0
}

# --- Déroulé ---

{
    echo "Recette d'installation LorIAx"
    echo "Dépôt : $REPO ($(git -C "$REPO" rev-parse --short HEAD 2>/dev/null))"
    echo "Date  : $(date '+%Y-%m-%d %H:%M')"
    printf '%-52s %-6s %6s  %s\n' "Étape" "Résultat" "Durée" "Détail"
} | tee "$REPORT"

if step "1.1 clone et install.sh non interactif" s_clone_install; then
    step "1.2 /api/health renvoie 200" s_health
    step "1.3 page de connexion et mention IA" s_login_page
    if step "2.1 assistant : clé, administrateur, fin" s_setup; then
        if step "2.2 connexion de l'administrateur" s_login; then
            step "2.3 espace personnel" s_space
            step "2.4 création d'un document" s_document
            step "2.5 création d'une base" s_database
            step "2.6 création d'une automatisation (manuelle)" s_automation
            step "2.7 création d'une présentation" s_presentation
            step "2.8 création d'un design" s_design
            step "2.9 modules actifs, sans studiovideo ni commercial" s_modules
            step "2.10 routes supprimées répondent 404" s_removed_routes
            step "3.1 sans IA, S3 distant ni LiveKit : modules coupés" s_optional_off
            step "3.2 aucune erreur 500 dans les journaux de app" s_no_500
        fi
    fi
fi

if [ "$SKIP_UPGRADE" != true ]; then
    if step "4.1 démarrage de l'ancienne version 1.21.x" s_old_stack; then
        if step "4.2 contenu créé sous 1.21.x" s_old_content; then
            step "4.2b pièce jointe déposée sous 1.21.x" s_old_attachment
            step "4.2c inscription stockée comme ouverte sous 1.21.x" s_old_registration
            if step "4.3 relance en 2.0.0 sur le même volume" s_upgrade; then
                step "4.4 document 1.21.x lisible après mise à jour" s_upgrade_read
                step "4.4b inscription refermée après mise à jour (register refusé)" s_upgrade_registration_closed
                [ -n "$OLD_ATT_KEY" ] && step "4.5 pièce jointe 1.21.x servie après mise à jour" s_upgrade_attachment
            fi
        fi
    fi
fi

echo "" | tee -a "$REPORT"
if [ "$FAILED" = 0 ]; then echo "Résultat global : OK" | tee -a "$REPORT"; else echo "Résultat global : ECHEC" | tee -a "$REPORT"; fi
exit "$FAILED"
