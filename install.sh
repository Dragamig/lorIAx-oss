#!/bin/bash
# ============================================================
# LorIAx : script d'installation auto-hébergée
# Usage : bash install.sh [--livekit]
#   --livekit : ajoute la visioconférence (docker-compose.livekit.yml)
# Variable facultative : LORIAX_URL pour installer sans question
#   (ex : LORIAX_URL=https://wiki.exemple.fr bash install.sh)
# ============================================================

set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${BLUE}[LorIAx]${NC} $1"; }
success() { echo -e "${GREEN}[LorIAx]${NC} $1"; }
warn()    { echo -e "${YELLOW}[LorIAx]${NC} $1"; }
error()   { echo -e "${RED}[LorIAx]${NC} $1" >&2; exit 1; }

WITH_LIVEKIT=false
for arg in "$@"; do
    case "$arg" in
        --livekit) WITH_LIVEKIT=true ;;
        *) error "Option inconnue : $arg (option disponible : --livekit)" ;;
    esac
done

# Se placer à la racine du dépôt, quel que soit le dossier d'appel.
cd "$(dirname "${BASH_SOURCE[0]}")"
[ -f docker-compose.yml ] || error "docker-compose.yml introuvable : lancez install.sh depuis la racine du dépôt."

echo ""
info "Installation de LorIAx, plateforme collaborative de gestion de connaissances"
echo ""

# --- Vérifications préalables ---

command -v docker >/dev/null 2>&1 || error "Docker n'est pas installé. Voir : https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || error "Docker Compose v2 requis. Voir : https://docs.docker.com/compose/install/"
command -v openssl >/dev/null 2>&1 || error "openssl est requis pour générer les secrets."
command -v curl >/dev/null 2>&1 || error "curl est requis pour vérifier le démarrage."

info "Docker détecté : $(docker --version)"

COMPOSE_FILES=(-f docker-compose.yml)
if [ "$WITH_LIVEKIT" = true ]; then
    COMPOSE_FILES+=(-f docker-compose.livekit.yml)
fi

# --- Fichier .env ---

if [ -f .env ]; then
    # Régénérer les secrets casserait la base et le stockage déjà créés : on conserve le .env.
    warn ".env existant conservé (les secrets ne sont pas régénérés)."
    APP_URL=$(grep -E '^NEXTAUTH_URL=' .env | head -n 1 | cut -d= -f2-)
    APP_URL="${APP_URL:-http://localhost:3000}"
else
    APP_URL="${LORIAX_URL:-}"
    if [ -z "$APP_URL" ]; then
        echo ""
        read -rp "  Adresse publique de l'instance (ex : https://wiki.exemple.fr, vide pour http://localhost:3000) : " APP_URL
    fi
    APP_URL="${APP_URL:-http://localhost:3000}"
    case "$APP_URL" in
        http://*|https://*) ;;
        *) APP_URL="https://${APP_URL}" ;;
    esac

    info "Génération des secrets..."
    bash scripts/generate-env.sh "$APP_URL" > .env
    chmod 600 .env
    if [ "$WITH_LIVEKIT" = true ]; then
        sed -i.bak 's/^LIVEKIT_ENABLED=.*/LIVEKIT_ENABLED=true/' .env && rm -f .env.bak
    fi
    success ".env créé."
fi

# --- Construction et lancement ---

echo ""
info "Construction depuis les sources et démarrage des services (plusieurs minutes au premier lancement)..."
docker compose "${COMPOSE_FILES[@]}" up -d --build

# --- Attente de l'application (le service app-migrate prépare la base avant son démarrage) ---

info "Attente du démarrage de l'application..."
READY=false
for _ in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
        READY=true
        break
    fi
    sleep 5
done
if [ "$READY" != true ]; then
    warn "L'application ne répond pas encore. Consultez : docker compose ${COMPOSE_FILES[*]} logs app-migrate app"
fi

# --- Résumé ---

SETUP_TOKEN=$(grep -E '^SETUP_BOOTSTRAP_TOKEN=' .env | head -n 1 | cut -d= -f2-)

echo ""
success "LorIAx est démarré."
echo ""
echo "  Adresse        : ${APP_URL}"
echo "  Écoute locale  : http://127.0.0.1:3000"
echo "  Journaux       : docker compose ${COMPOSE_FILES[*]} logs -f app"
echo ""
info "Placez un reverse proxy HTTPS (Caddy, Nginx, Traefik) devant http://127.0.0.1:3000."
info "Aucun compte n'existe encore. Ouvrez ${APP_URL}/setup pour créer le premier"
info "super administrateur. La clé d'installation demandée est :"
echo ""
echo "    ${SETUP_TOKEN}"
echo ""
info "Elle est aussi dans le .env (SETUP_BOOTSTRAP_TOKEN) et cesse d'être acceptée"
info "dès que la configuration est terminée."
echo ""
warn "Conservez le fichier .env en lieu sûr, il contient vos secrets."
echo ""
