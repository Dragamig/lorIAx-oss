#!/bin/bash
# ============================================================
# LorIAx : génération du fichier .env (secrets aléatoires)
# Usage : bash scripts/generate-env.sh [URL_PUBLIQUE] > .env
# Exemple : bash scripts/generate-env.sh https://wiki.exemple.fr > .env
# Sans argument, l'URL publique est http://localhost:3000.
# ============================================================

set -euo pipefail

command -v openssl >/dev/null 2>&1 || { echo "openssl est requis pour générer les secrets." >&2; exit 1; }

APP_URL="${1:-http://localhost:3000}"
APP_URL="${APP_URL%/}"

# Mot de passe PostgreSQL : sans caractère réservé d'une URL (il est inséré dans DATABASE_URL).
POSTGRES_PASSWORD=$(openssl rand -base64 33 | tr -d '/+=\n' | cut -c1-32)
NEXTAUTH_SECRET=$(openssl rand -base64 32)
# Clé de 32 octets en base64 : chiffre en base les clés des fournisseurs d'IA, le mot de passe LDAP, etc.
ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)
SETUP_BOOTSTRAP_TOKEN=$(openssl rand -hex 24)
# Garage exige une clé d'accès au format GK + 24 caractères hexadécimaux.
S3_ACCESS_KEY="GK$(openssl rand -hex 12)"
S3_SECRET_KEY=$(openssl rand -hex 32)
LIVEKIT_API_KEY="API$(openssl rand -hex 6)"
LIVEKIT_API_SECRET=$(openssl rand -hex 32)

cat <<ENV
# ============================================================
# LorIAx : variables d'environnement
# Généré le $(date +%Y-%m-%d) par scripts/generate-env.sh
# Ce fichier contient des secrets : ne le versionnez jamais.
# ============================================================

# --- Base de données ---
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
DATABASE_URL=postgresql://loriax:${POSTGRES_PASSWORD}@postgres:5432/loriax

# --- Authentification ---
NEXTAUTH_URL=${APP_URL}
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}
NEXT_PUBLIC_APP_URL=${APP_URL}

# --- Chiffrement ---
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# --- Tâches planifiées (en-tête Authorization: Bearer <secret>) ---
CRON_SECRET=${CRON_SECRET}

# --- Assistant de configuration (/setup) ---
# Clé à saisir pour créer le premier super administrateur.
SETUP_BOOTSTRAP_TOKEN=${SETUP_BOOTSTRAP_TOKEN}

# --- Stockage objet (Garage S3) ---
S3_ENDPOINT=garage
S3_PORT=3900
S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}
S3_BUCKET=loriax-files
S3_REGION=garage
S3_USE_SSL=false

# --- Documents ---
WORKSPACES_PATH=/app/workspaces

# --- IA (optionnel, configurable aussi dans l'administration) ---
DEFAULT_AI_PROVIDER=ollama
DEFAULT_AI_MODEL=gemma4:e4b
# ANTHROPIC_API_KEY=
# OPENAI_API_KEY=
# MISTRAL_API_KEY=

# --- Visioconférence (optionnel, voir docker-compose.livekit.yml) ---
LIVEKIT_ENABLED=false
LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
# LIVEKIT_URL=wss://visio.exemple.fr
WHISPER_ENABLED=false
# Voxtral est desactive par defaut : cette valeur remplace le defaut de l'application.
# Passer a true seulement avec le profil Docker "voxtral" (GPU NVIDIA).
VOXTRAL_ENABLED=false
ENV
