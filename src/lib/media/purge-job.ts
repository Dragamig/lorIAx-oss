import { purgeExpiredTrash, type PurgeReport } from "@/lib/media/purge";
import { notifyTrashNearPurge } from "@/lib/media/notify";
import { trashStaleDesignThumbnails } from "@/lib/media/stale-thumbnails";
import { abortStaleMultipartUploads } from "@/lib/media/multipart";
import logger from "@/lib/logger";

/** Planification coupée par MEDIA_PURGE_DISABLED=1 ou, comme le balayage d'usages, MEDIA_USAGE_SWEEP=off. */
export function isMediaPurgeDisabled(): boolean {
  const off = (process.env.MEDIA_PURGE_DISABLED ?? "").trim().toLowerCase();
  const sweep = (process.env.MEDIA_USAGE_SWEEP ?? "").trim().toLowerCase();
  return off === "1" || off === "true" || sweep === "off";
}

export type MediaPurgeRun = PurgeReport & { notified: number; thumbnailsTrashed: number; multipartAborted: number };

/** Corbeille des miniatures de design sans usage depuis 7 jours, purge des médias échus, envois multipart abandonnés, puis notification. */
export async function runMediaPurge(now: Date = new Date()): Promise<MediaPurgeRun> {
  const { trashed } = await trashStaleDesignThumbnails(now);
  const report = await purgeExpiredTrash({ now });
  const { aborted, orphans } = await abortStaleMultipartUploads(now);
  const { notified } = await notifyTrashNearPurge(now);
  return { ...report, notified, thumbnailsTrashed: trashed, multipartAborted: aborted + orphans };
}

let running = false;

export type MediaPurgeJobResult =
  | ({ status: "ok" } & MediaPurgeRun)
  | { status: "skipped"; skipped: "running" | "disabled" }
  | { status: "failed" };

/** Enveloppe sûre (planificateur interne et route cron) : jamais d'exception, jamais deux exécutions en parallèle. */
export async function runMediaPurgeJob(): Promise<MediaPurgeJobResult> {
  if (isMediaPurgeDisabled()) {
    logger.info("Purge de la corbeille médias ignorée : désactivée");
    return { status: "skipped", skipped: "disabled" };
  }
  if (running) {
    logger.info("Purge de la corbeille médias ignorée : une exécution est déjà en cours");
    return { status: "skipped", skipped: "running" };
  }
  running = true;
  try {
    const r = await runMediaPurge();
    logger.info(
      { purged: r.purged, failed: r.failed.length, notified: r.notified },
      "Purge planifiée de la corbeille médias terminée"
    );
    return { status: "ok", ...r };
  } catch (err) {
    logger.error({ err }, "Erreur de la purge planifiée de la corbeille médias");
    return { status: "failed" };
  } finally {
    running = false;
  }
}
