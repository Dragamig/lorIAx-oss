# syntax=docker/dockerfile:1.7
# ============================================================
# LorIAx — Dockerfile Production (multi-stage optimisé)
#
# Cache mounts BuildKit activés (~/.npm et .next/cache) pour
# accélérer les builds incrémentaux. Premier build : ~5 min.
# Builds suivants (code seul modifié) : ~1-2 min.
# Nécessite DOCKER_BUILDKIT=1 (par défaut sur Docker >= 23).
# ============================================================

FROM node:22-alpine AS base

# libc6-compat/curl : compat glibc + healthcheck.
# Toolchain node-canvas (paquet `canvas`, dep du rendu serveur des designs —
# src/lib/studio/render-design.ts) : sous Alpine/musl il n'y a pas de binaire
# prébuild, `npm ci` compile canvas depuis les sources → il faut build-base/g++/
# python3/pkgconfig + les headers Cairo/Pango/JPEG/GIF/RSVG/Pixman. Partagé par
# les stages deps et deps-prod (qui installent canvas), pas embarqué dans le runner.
RUN apk add --no-cache \
    libc6-compat curl \
    build-base g++ python3 pkgconfig \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev
WORKDIR /app

# --- Étape 1 : Dépendances complètes (build) ---
# Timeouts longs + retries : protège contre les binaires natifs lourds
# (livekit, @next/swc, ollama) qui dépassent le timeout npm par défaut (60s).
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --legacy-peer-deps \
      --fetch-timeout=600000 \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000

# --- Étape 1b : Dépendances production seules (runtime) ---
FROM base AS deps-prod
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --legacy-peer-deps \
      --fetch-timeout=600000 \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=20000 \
      --fetch-retry-maxtimeout=120000

# --- Étape 2 : Build Next.js + custom server ---
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Polices du rendu vidéo : le dossier est absent d'un arbre sans studio vidéo ; le créer
# vide garde la copie finale valide dans les deux cas (no-op quand il existe).
RUN mkdir -p /app/assets/video-fonts

# Variables NEXT_PUBLIC_* : inlinées par Next.js dans les bundles client au
# moment du build. Doivent donc être fournies en build-args (le `.env` runtime
# arrive trop tard). Voir scripts/build-and-push.sh.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_LICENSE_MANAGER_URL
ARG NEXT_PUBLIC_ENTERPRISE_CONTACT_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_ROOT_DOMAIN=${NEXT_PUBLIC_ROOT_DOMAIN} \
    NEXT_PUBLIC_LICENSE_MANAGER_URL=${NEXT_PUBLIC_LICENSE_MANAGER_URL} \
    NEXT_PUBLIC_ENTERPRISE_CONTACT_URL=${NEXT_PUBLIC_ENTERPRISE_CONTACT_URL}

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
# Tas Node relevé : la vérification des types de next build dépasse 2 Go depuis le lot 7 CRM
ENV NODE_OPTIONS=--max-old-space-size=6144

# Build Next.js (standalone output)
# Cache .next/cache : Turbopack/SWC réutilisent la compilation entre builds
# lorsque le code source n'a pas changé.
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# Bundle custom server (Hocuspocus WebSocket) avec esbuild
# --packages=external : les packages npm restent en require() externe (non bundlés)
# --bundle résout et inline les imports locaux (@/* alias inclus)
# --alias:server-only : le code local inliné (ex. url-validator-server.ts) peut
#   faire `import "server-only"` ; on l'aliase vers un stub vide pour éviter un
#   `require("server-only")` externe (package non installé en runtime → crash).
RUN node_modules/.bin/esbuild server.ts \
    --bundle \
    --platform=node \
    --target=node22 \
    --packages=external \
    --alias:server-only=./esbuild-stubs/server-only.js \
    --outfile=.next/standalone/server.js \
    --tsconfig=tsconfig.json

# Bundle du render-worker vidéo (module studiovideo) — même mécanique que
# server.ts. Conditionnel : le fichier est pruné des builds clients qui
# excluent le module (le try/catch de server.ts couvre l'absence au runtime).
RUN if [ -f src/lib/video/render-worker.ts ]; then \
      node_modules/.bin/esbuild src/lib/video/render-worker.ts \
        --bundle \
        --platform=node \
        --target=node22 \
        --packages=external \
        --alias:server-only=./esbuild-stubs/server-only.js \
        --outfile=.next/standalone/render-worker.js \
        --tsconfig=tsconfig.json ; \
    fi

# --- Étape 3 : Image de production minimale ---
FROM node:22-alpine AS runner
WORKDIR /app

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

# curl : healthcheck · ffmpeg : rendu vidéo (paquet système de la distro, invoqué
# comme processus séparé — remplace le binaire GPL embarqué `ffmpeg-static`,
# cf. docs/briques-libres-licences.md §4.2)
# Libs runtime node-canvas (rendu serveur des designs, src/lib/studio/render-design.ts) :
# le .node compilé au stage deps-prod a besoin des shared libs Cairo/Pango/JPEG/
# GIF/RSVG/Pixman à l'exécution. fontconfig + polices (Noto, DejaVu) : fontconfig
# résout les familles par nom ; sans pack de polices le texte serait vide → repli
# gracieux (les TTF LorIAx empaquetées sont enregistrées en plus via registerFont).
RUN apk add --no-cache curl ffmpeg \
    cairo pango jpeg giflib librsvg pixman \
    fontconfig font-noto ttf-dejavu

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Utilisateur non-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copier les fichiers de build
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db/migrations ./migrations
# Fiches de la KB d'aide : lues sur disque par indexKbFromDisk (docs/kb)
COPY --from=builder --chown=nextjs:nodejs /app/docs/kb ./docs/kb
# Polices OFL du rendu vidéo (drawtext) — cf. assets/video-fonts/README.md
COPY --from=builder --chown=nextjs:nodejs /app/assets/video-fonts ./assets/video-fonts

# Dépendances de production pour server.ts (non tracées par le standalone Next.js)
COPY --from=deps-prod --chown=nextjs:nodejs /app/node_modules ./node_modules

# Dossier workspaces (volumes git pour les documents)
RUN mkdir -p /app/workspaces && chown nextjs:nodejs /app/workspaces

# Dossier des fichiers audio des notes vocales (VOICE_NOTES_AUDIO_DIR).
# Doit exister ET appartenir a nextjs AVANT le montage du volume nomme :
# Docker initialise un volume vide avec les droits du point de montage present
# dans l'image. Sans ce mkdir, le volume serait cree root et l'application,
# qui tourne en nextjs, ne pourrait pas y ecrire.
RUN mkdir -p /app/voice-notes && chown nextjs:nodejs /app/voice-notes

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Healthcheck intégré (vérifie /api/health toutes les 30s)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

LABEL org.opencontainers.image.title="LorIAx" \
      org.opencontainers.image.description="Plateforme collaborative de gestion de connaissances" \
      org.opencontainers.image.source="https://github.com/your-org/loriax" \
      org.opencontainers.image.version="${APP_VERSION}"

CMD ["node", "server.js"]
