import { and, count, eq, gt, isNotNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaUsages } from "@/lib/db/schema";
import type { Media } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { auditLog } from "@/lib/audit/log";
import { deleteFile } from "@/lib/storage/s3";
import { getMediaFull, isOrgAdminOrOwner } from "@/lib/media/access";
import { getTrashRetentionPolicy } from "@/lib/media/library-settings";
import { refreshQuotaSentinel } from "@/lib/media/notify";
import type { DbTx } from "@/lib/media/quota";
import logger from "@/lib/logger";
import type { SessionUser } from "@/types";

const DAY_MS = 86_400_000;
const DEFAULT_BATCH = 50;

export type PurgeReport = {
  purged: number;
  skipped: number;
  failed: { id: string; error: string }[];
};

export class PurgeError extends Error {
  status: 403 | 404;
  constructor(status: 403 | 404, message: string) {
    super(message);
    this.status = status;
    this.name = "PurgeError";
  }
}

/**
 * Une autre ligne `media` (corbeille comprise : une ligne supprimée en douceur
 * référence encore l'objet) porte-t-elle déjà cette clé de stockage ou de
 * miniature ?
 */
async function isKeyShared(tx: DbTx, key: string, excludeId: string): Promise<boolean> {
  const [other] = await tx
    .select({ id: media.id })
    .from(media)
    .where(and(ne(media.id, excludeId), or(eq(media.storageKey, key), eq(media.thumbnailKey, key))))
    .limit(1);
  return !!other;
}

async function countUsages(tx: DbTx, mediaId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(mediaUsages)
    .where(eq(mediaUsages.mediaId, mediaId));
  return Number(r?.n ?? 0);
}

type Removed = { row: Media; usages: number };

/**
 * Seul point de suppression d'objet S3 de la médiathèque. La ligne est
 * verrouillée (FOR UPDATE, SKIP LOCKED pour la purge) puis son éligibilité est
 * revérifiée : une restauration concurrente l'emporte. Le contrôle de partage
 * et la suppression de la ligne `media` se font dans la même transaction. L'objet S3 n'est supprimé qu'après le commit : un orphelin
 * S3 vaut mieux qu'une perte de données, un échec est journalisé et ignoré.
 * Renvoie null si la ligne n'est plus éligible.
 */
async function removeMedia(id: string, opts: { purgeCutoff?: Date }): Promise<Removed | null> {
  const cutoff = opts.purgeCutoff;
  const outcome = await db.transaction(async (tx) => {
    const query = tx
      .select()
      .from(media)
      .where(
        cutoff
          ? and(eq(media.id, id), isNotNull(media.deletedAt), lt(media.deletedAt, cutoff))
          : eq(media.id, id)
      );
    const [row] = cutoff ? await query.for("update", { skipLocked: true }) : await query.for("update");
    if (!row) return null;
    if (cutoff && (!row.deletedAt || row.deletedAt.getTime() >= cutoff.getTime())) return null;

    const usages = await countUsages(tx, row.id);
    const keys = [...new Set([row.storageKey, row.thumbnailKey].filter((k): k is string => !!k))];
    const orphanKeys: string[] = [];
    for (const key of keys) {
      if (!(await isKeyShared(tx, key, row.id))) orphanKeys.push(key);
    }
    await tx.delete(media).where(eq(media.id, row.id));
    return { row, usages, orphanKeys };
  });
  if (!outcome) return null;

  for (const key of outcome.orphanKeys) {
    try {
      await deleteFile(key);
    } catch (err) {
      logger.warn({ err, mediaId: outcome.row.id, key }, "Objet S3 orphelin : suppression en échec après purge");
    }
  }
  await refreshQuotaSentinel(outcome.row.organizationId);
  return { row: outcome.row, usages: outcome.usages };
}

/** Purge les médias dont le délai de corbeille est échu (par lots, sans jamais lire le contenu). */
export async function purgeExpiredTrash(opts?: { now?: Date; batch?: number }): Promise<PurgeReport> {
  const now = opts?.now ?? new Date();
  const batch = opts?.batch ?? DEFAULT_BATCH;
  const { effectiveDays } = await getTrashRetentionPolicy(now);
  const cutoff = new Date(now.getTime() - effectiveDays * DAY_MS);
  const report: PurgeReport = { purged: 0, skipped: 0, failed: [] };

  let lastId: string | null = null;
  for (;;) {
    const rows: { id: string }[] = await db
      .select({ id: media.id })
      .from(media)
      .where(
        and(
          isNotNull(media.deletedAt),
          lt(media.deletedAt, cutoff),
          lastId ? gt(media.id, lastId) : undefined
        )
      )
      .orderBy(media.id)
      .limit(batch);
    if (rows.length === 0) break;
    for (const { id } of rows) {
      try {
        const removed = await removeMedia(id, { purgeCutoff: cutoff });
        if (!removed) {
          report.skipped += 1;
          continue;
        }
        report.purged += 1;
        auditLog("media.purge", null, {
          mediaId: removed.row.id,
          filename: removed.row.filename,
          sizeBytes: removed.row.sizeBytes,
          usages: removed.usages,
        });
      } catch (e) {
        report.failed.push({ id, error: e instanceof Error ? e.message : "purge failed" });
      }
    }
    lastId = rows[rows.length - 1].id;
    if (rows.length < batch) break;
  }
  return report;
}

/** Effacement définitif immédiat, réservé aux admins d'organisation, hors corbeille compris. */
export async function eraseMediaForever(user: SessionUser, orgId: string, id: string): Promise<void> {
  const row = await getMediaFull(id);
  if (!row || row.organizationId !== orgId) throw new PurgeError(404, "Média introuvable");
  if (!(await isOrgAdminOrOwner(user.id, orgId))) {
    throw new PurgeError(403, "Réservé aux administrateurs de l'organisation");
  }
  const removed = await removeMedia(row.id, {});
  if (!removed) throw new PurgeError(404, "Média introuvable");
  const { usages } = removed;
  auditLog("media.erase", user.id, {
    mediaId: removed.row.id,
    filename: removed.row.filename,
    sizeBytes: removed.row.sizeBytes,
    usages,
    wasTrashed: removed.row.deletedAt !== null,
  });
  await logActivity({
    userId: user.id,
    action: "media.erased",
    entityType: "media",
    entityId: row.id,
    metadata: { filename: row.filename, usages },
  });
}
