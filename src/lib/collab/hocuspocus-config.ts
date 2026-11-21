import { Hocuspocus } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import * as Y from "yjs";
import { verifyWsToken, checkDocumentAccess, checkCollabDocumentEditAccess } from "./auth-ws";
import { fetchYjsState, storeYjsState } from "./yjs-persistence";
import { syncYjsToStorage } from "./markdown-sync";
import logger from "@/lib/logger";
import { createMessageRateLimiter, RATE_LIMIT_CLOSE_CODE } from "./message-rate-limit";

// UUID v4 format validation (H5 — reject invalid document names)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Debounce map for storage sync (avoid git commit on every keystroke)
const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
const SYNC_DEBOUNCE_MS = 30_000; // 30 seconds

/**
 * Create and configure the Hocuspocus collaboration server.
 */
export function createHocuspocusServer(): Hocuspocus {
  // Un limiteur par serveur, état purgé à la déconnexion de chaque connexion
  const rateLimiter = createMessageRateLimiter();

  const server = new Hocuspocus({
    name: "loriax-collab",
    timeout: 30000,
    debounce: 2000,
    maxDebounce: 10000,
    quiet: process.env.NODE_ENV === "production",

    // Limiteur de débit : une exception ici ferme la connexion (Hocuspocus lit
    // `code` et `reason` de l'erreur pour le close du WebSocket).
    async beforeHandleMessage(data: { socketId: string; documentName: string; update: Uint8Array }) {
      const key = `${data.socketId}:${data.documentName}`;
      if (!rateLimiter.allow(key, data.update)) {
        logger.warn(
          { socketId: data.socketId, documentName: data.documentName },
          "[collab] Débit de messages dépassé, connexion fermée"
        );
        throw Object.assign(new Error("Trop de messages"), {
          code: RATE_LIMIT_CLOSE_CODE,
          reason: "Trop de messages",
        });
      }
    },

    async onAuthenticate(data: {
      token: string;
      documentName: string;
      /**
       * Configuration de la connexion fournie par Hocuspocus (v3 : le champ
       * s'appelle `connectionConfig`, il s'appelait `connection` en v1/v2).
       * `readOnly` y vaut `false` par défaut : c'est à ce crochet de le poser
       * à `true` quand l'utilisateur n'a pas le droit d'écrire (AZ-09).
       * Optionnel côté typage seulement, pour ne pas dépendre de la forme
       * exacte du payload ; son absence est traitée en refus (fail-closed).
       */
      connectionConfig?: { readOnly: boolean; isAuthenticated?: boolean };
    }) {
      // Validate documentName is a valid UUID (H5 — prevent path traversal / injection)
      if (!UUID_RE.test(data.documentName)) {
        logger.warn({ documentName: data.documentName }, "[collab] Invalid documentName format — not a UUID");
        throw new Error("Identifiant de document invalide");
      }

      // Verify JWT
      const user = await verifyWsToken(data.token);
      if (!user) {
        logger.warn({ documentName: data.documentName }, "[collab] JWT verification failed — Non autorisé");
        throw new Error("Non autorisé");
      }

      // Jeton émis avant le cloisonnement multi-tenant du canal WS : il ne
      // porte pas d'organisation, donc il est refusé (fail-closed). Le motif
      // est distinct d'« Accès refusé » pour que le client redemande un jeton
      // neuf à /api/auth/ws-token au lieu de boucler sur un refus.
      if (!user.orgId) {
        logger.warn(
          { userId: user.id, documentName: data.documentName },
          "[collab] Jeton sans organisation — reconnexion requise"
        );
        throw new Error("Session expirée");
      }

      logger.info({ userId: user.id, globalRole: user.globalRole, orgId: user.orgId, documentName: data.documentName }, "[collab] JWT OK, checking access...");

      // Check document access
      const hasAccess = await checkDocumentAccess(
        user.id,
        data.documentName,
        user.globalRole,
        user.orgId
      );
      if (!hasAccess) {
        logger.warn({ userId: user.id, globalRole: user.globalRole, documentName: data.documentName }, "[collab] checkDocumentAccess returned false — Accès refusé");
        throw new Error("Accès refusé");
      }

      // AZ-09 : la lecture ne donne pas l'écriture. Hocuspocus laisse
      // `readOnly` à false par défaut, donc sans ce contrôle un membre d'espace
      // au niveau `viewer` pousse des mises à jour Yjs qui sont appliquées au
      // document partagé et diffusées à tous les éditeurs connectés. Le
      // `editable=false` de l'éditeur est purement client, donc sans valeur.
      const canEdit = await checkCollabDocumentEditAccess(
        user.id,
        data.documentName,
        user.orgId
      );

      if (!canEdit) {
        if (!data.connectionConfig) {
          // Payload inattendu : impossible de poser la lecture seule, donc on
          // refuse la connexion au lieu de l'ouvrir en écriture (fail-closed).
          logger.error(
            { userId: user.id, documentName: data.documentName },
            "[collab] connectionConfig absent, lecture seule impossible a imposer, connexion refusee"
          );
          throw new Error("Accès refusé");
        }
        data.connectionConfig.readOnly = true;
        logger.info(
          { userId: user.id, documentName: data.documentName },
          "[collab] Droit d'ecriture absent, connexion ouverte en lecture seule"
        );
      }

      // Return user context (available in other hooks via context)
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          // Organisation portée par le jeton signé — sert au cloisonnement
          // des re-vérifications d'écriture (hook `store`).
          orgId: user.orgId,
        },
      };
    },

    extensions: [
      new Database({
        async fetch(data: { documentName: string }) {
          const state = await fetchYjsState(data.documentName);
          return state || null;
        },

        async store(data: { documentName: string; state: Uint8Array; context: Record<string, unknown> }) {
          // Défense en profondeur. Depuis AZ-09, une connexion dépourvue du
          // droit d'écriture est ouverte en lecture seule et ses mises à jour
          // n'atteignent jamais le Y.Doc partagé. Ce contrôle ne reste utile
          // que pour un retrait de droit survenu après l'ouverture de la
          // connexion (C3), cas que `readOnly`, figé à la connexion, ne couvre
          // pas.
          const user = data.context?.user as
            | { id: string; name: string; email: string; orgId: string | null }
            | undefined;
          if (user?.id) {
            const hasEditAccess = await checkCollabDocumentEditAccess(
              user.id,
              data.documentName,
              user.orgId ?? null
            );
            if (!hasEditAccess) {
              logger.warn({ userId: user.id, documentName: data.documentName }, "[collab] Edit access revoked — store blocked");
              return;
            }
          }

          // Store Yjs state immediately
          await storeYjsState(data.documentName, data.state);

          // Debounced sync to filesystem + git
          const existingTimer = syncTimers.get(data.documentName);
          if (existingTimer) clearTimeout(existingTimer);

          const userId = user?.id;
          const userOrgId = user?.orgId ?? null;
          syncTimers.set(
            data.documentName,
            setTimeout(async () => {
              syncTimers.delete(data.documentName);
              try {
                const ydoc = new Y.Doc();
                Y.applyUpdate(ydoc, data.state);
                await syncYjsToStorage(data.documentName, ydoc, userId, userOrgId);
                ydoc.destroy();
              } catch (err) {
                logger.error({ err }, "[hocuspocus] Sync error");
              }
            }, SYNC_DEBOUNCE_MS)
          );
        },
      }),
    ],

    async onDisconnect(data: { documentName: string; socketId?: string }) {
      if (data.socketId) rateLimiter.release(`${data.socketId}:${data.documentName}`);
      // Flush pending sync on last disconnect
      const timer = syncTimers.get(data.documentName);
      if (timer) {
        clearTimeout(timer);
        syncTimers.delete(data.documentName);

        try {
          const state = await fetchYjsState(data.documentName);
          if (state) {
            const ydoc = new Y.Doc();
            Y.applyUpdate(ydoc, state);
            await syncYjsToStorage(data.documentName, ydoc);
            ydoc.destroy();
          }
        } catch (err) {
          logger.error({ err }, "[hocuspocus] Disconnect sync error");
        }
      }
    },
  });

  return server;
}
