import { createServer } from "http";
import { parse } from "url";
import path from "path";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { createHocuspocusServer } from "./src/lib/collab/hocuspocus-config";
import { ChatServer } from "./src/lib/chat/chat-server";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { INCLUDED_MODULE_IDS } from "./src/lib/modules/registry.generated";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

async function main() {
  // Run DB migrations on startup
  const migrationsFolder = dev
    ? path.join(__dirname, "src/lib/db/migrations")
    : path.join(__dirname, "migrations");

  const migrationPool = new Pool({ connectionString: process.env.DATABASE_URL });
  const migrationDb = drizzle(migrationPool);
  try {
    await migrate(migrationDb, { migrationsFolder });
    console.log("✓ Migrations appliquées");
  } catch (err) {
    console.error("✗ Échec des migrations:", err);
    process.exit(1);
  } finally {
    await migrationPool.end();
  }

  // Initialize Next.js
  const app = next({ dev, hostname, port, turbopack: dev });
  const handle = app.getRequestHandler();

  await app.prepare();

  // Initialize backup scheduler
  const { initBackupScheduler } = await import("./src/lib/backup/scheduler");
  await initBackupScheduler();

  // Tâches de fond fournies par les modules inclus (télémétrie, échéance des
  // niveaux de compte pour l'édition commerciale). No-op sans module.
  const { getHooks } = await import("./src/lib/modules/hooks");
  await getHooks().lifecycle.start();

  // Render worker vidéo — module optionnel (studiovideo). Chargé seulement si
  // présent dans l'image ; le cast `as string` évite que tsc résolve le chemin
  // littéral après prune (sinon TS2307 sur le filet de sécurité).
  if (INCLUDED_MODULE_IDS.includes("studiovideo")) {
    // Chargement défensif : l'import via variable n'est pas inliné par esbuild
    // (bundle standalone) et le fichier peut être absent de l'image runtime —
    // le flag registre ne garantit pas sa présence. En cas d'échec, on dégrade
    // le rendu vidéo plutôt que de tuer le serveur (sinon crash-loop au boot).
    try {
      // En prod : bundle esbuild généré par le Dockerfile à côté de server.js.
      // En dev : sources TS (résolues par tsx). L'import via variable reste
      // volontairement opaque pour esbuild/tsc (module prunable SP2).
      const renderWorkerSpec = dev
        ? "./src/lib/video/render-worker"
        : "./render-worker.js";
      const { startRenderWorker } = (await import(renderWorkerSpec as string)) as {
        startRenderWorker: () => void;
      };
      startRenderWorker();
    } catch (err) {
      console.warn(
        "[studiovideo] render-worker indisponible — rendu vidéo désactivé:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Schedule daily chat digest at 08:00
  const { Cron } = await import("croner");
  const { sendChatDigests } = await import("./src/lib/chat/chat-notifications");
  new Cron("0 8 * * *", async () => {
    console.log("[chat-scheduler] Envoi des digests...");
    await sendChatDigests().catch((err) => console.error("[chat-scheduler] Erreur:", err));
  });

  // Schedule daily message retention purge at 03:00
  const { purgeExpiredMessages } = await import("./src/lib/chat/retention");
  new Cron("0 3 * * *", async () => {
    console.log("[chat-retention] Purge des messages expirés...");
    await purgeExpiredMessages().catch((err) => console.error("[chat-retention] Erreur:", err));
  });

  // Tick automatisations — toutes les minutes. Couvre les déclencheurs planifiés
  // (cron) et « date atteinte » (date_reached). Anti-doublon multi-pod garanti
  // par les verrous advisory de l'executor. Orchestration testée : scheduler-tick.ts.
  const { automationSchedulerTick } = await import("./src/lib/automations/scheduler-tick");
  // protect : pas de chevauchement de ticks (un SMTP lent ne doit pas empiler les exécutions).
  new Cron("* * * * *", { protect: true }, async () => {
    await automationSchedulerTick();
  });

  // Mailing : outbox sur sa propre Cron, indépendante des étapes d'automatisme
  // (une étape lente ne retarde plus les mails). Reprend les `scheduled` échus.
  const { mailingSchedulerTick } = await import("./src/lib/automations/scheduler-tick");
  new Cron("* * * * *", { protect: true }, async () => {
    await mailingSchedulerTick();
  });

  // Mailing : réarme les minuteries d'envoi différé perdues au redémarrage.
  const { armTimers: armMailTimers } = await import("./src/lib/mailing/tick");
  await armMailTimers().catch((err) => console.error("[mailing-arm] Erreur:", err));

  // Indexation automatique de la KB d'aide : une passe différée après le boot
  // (fiches livrées par un déploiement), puis chaque nuit à 03:30. Idempotent
  // par hash de contenu. Désactivable : KB_INDEX_SCHEDULE=off.
  const { runKbIndexJob, isKbIndexScheduleDisabled } = await import("./src/lib/kb/kb-scheduler");
  if (isKbIndexScheduleDisabled()) {
    console.log("[kb-index] Planification désactivée (KB_INDEX_SCHEDULE=off)");
  } else {
    setTimeout(() => {
      void runKbIndexJob();
    }, 60_000).unref();
    new Cron("30 3 * * *", async () => {
      await runKbIndexJob();
    });
  }

  // Balayage différé des usages médias (médiathèque) : toutes les 2 minutes, par
  // filigrane. Jamais appelé depuis la synchronisation Yjs. Désactivable :
  // MEDIA_USAGE_SWEEP=off.
  const { runMediaUsageSweepJob, isMediaUsageSweepDisabled } = await import("./src/lib/media/usage-sweep");
  if (isMediaUsageSweepDisabled()) {
    console.log("[media-usages] Balayage désactivé (MEDIA_USAGE_SWEEP=off)");
  } else {
    new Cron("*/2 * * * *", () => runMediaUsageSweepJob());
    // Réconciliation quotidienne (B54) : retire les usages `content` dont la cible a disparu.
    const { runMediaReconcileJob } = await import("./src/lib/media/reconcile");
    new Cron("30 3 * * *", () => runMediaReconcileJob());
  }

  // Purge quotidienne de la corbeille médias (4 h) puis notifications J-7.
  // Désactivable : MEDIA_PURGE_DISABLED=1 (ou MEDIA_USAGE_SWEEP=off).
  const { runMediaPurgeJob, isMediaPurgeDisabled } = await import("./src/lib/media/purge-job");
  if (isMediaPurgeDisabled()) {
    console.log("[media-purge] Purge planifiée désactivée (MEDIA_PURGE_DISABLED / MEDIA_USAGE_SWEEP=off)");
  } else {
    new Cron("0 4 * * *", async () => { await runMediaPurgeJob(); }, { protect: true });
  }

  // Indexation IA des médias (extraction, transcription, embeddings) : file en base sur
  // media_texts, prise toutes les 2 minutes, non réentrante. Coupe-circuit : MEDIA_INDEX_DISABLED=1.
  const { runMediaIndexJob, isMediaIndexDisabled } = await import("./src/lib/media/ai/index-job");
  if (isMediaIndexDisabled()) {
    console.log("[media-index] Indexation IA des médias désactivée (MEDIA_INDEX_DISABLED=1)");
  } else {
    new Cron("*/2 * * * *", async () => { await runMediaIndexJob(); }, { protect: true });
  }

  // Purge à 30 jours de l'historique des lignes supprimées, chaque nuit à 03:15.
  // Désactivable : ROW_HISTORY_PURGE=off.
  const { runRowHistoryPurgeJob, isRowHistoryPurgeDisabled } = await import("./src/lib/databases/row-history-purge");
  if (isRowHistoryPurgeDisabled()) {
    console.log("[row-history] Purge désactivée (ROW_HISTORY_PURGE=off)");
  } else {
    new Cron("15 3 * * *", () => runRowHistoryPurgeJob(), { protect: true });
  }

  // Initialize Hocuspocus collaboration server
  const hocuspocus = createHocuspocusServer();

  // Initialize Chat WebSocket server
  const chatServer = new ChatServer();

  // Create bare WebSocket server (no HTTP server — we handle upgrades manually)
  const wss = new WebSocketServer({ noServer: true });

  // Create HTTP server
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "", true);
    const method = req.method?.toUpperCase();
    const pathname = parsedUrl.pathname || "";

    // CalDAV: rewrite PROPFIND/REPORT to POST with X-HTTP-Method-Override
    // Next.js does not support non-standard HTTP methods natively
    if (
      pathname.startsWith("/api/caldav/") &&
      (method === "PROPFIND" || method === "REPORT")
    ) {
      req.headers["x-http-method-override"] = method;
      (req as unknown as { method: string }).method = "POST";
    }

    handle(req, res, parsedUrl);
  });

  // Handle WebSocket upgrades
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "", true);

    if (pathname === "/ws/chat") {
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        chatServer.handleConnection(ws);
      });
      return;
    }

    if (pathname === "/ws/collab") {
      // Upgrade to WebSocket, then pass to Hocuspocus
      wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
        hocuspocus.handleConnection(ws, req);
      });
    }
    // Other upgrades (Next.js HMR in dev) are handled by Next.js itself
  });

  server.listen(port, hostname, () => {
    console.log(`> LorIAx server ready on http://${hostname}:${port}`);
    console.log(`> Collaboration WebSocket on ws://${hostname}:${port}/ws/collab`);
    console.log(`> Mode: ${dev ? "development" : "production"}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
