import { and, eq, inArray, isNull, like, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaUsages } from "@/lib/db/schema-media";
import { templates } from "@/lib/db/schema";
import { auditLog } from "@/lib/audit/log";
import logger from "@/lib/logger";
import { getSweepHealth } from "./usage-sweep";

export const DESIGN_THUMBNAIL_NAME = "Miniature de design";
/** Chemin de clé propre aux miniatures de design (posé à l'envoi, non modifiable ensuite). */
export const DESIGN_THUMBNAIL_KEY_PATTERN = "studio/%/design-thumbnails/%";
export const STALE_THUMBNAIL_DAYS = 7;
/** Retard toléré du balayage des usages avant de suspendre le ramassage. */
export const SWEEP_GRACE_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;
const BATCH = 200;

/** Borne d'ancienneté : jamais au-delà du filigrane des documents (usages connus jusque-là). */
export function thumbnailBarrier(cutoff: Date, documentsWatermark: Date): Date {
  return documentsWatermark.getTime() < cutoff.getTime() ? documentsWatermark : cutoff;
}

/**
 * Un modèle de document (`templates.content`) contient-il l'id du média ?
 * Les modèles ne sont pas balayés (pas de cible d'usage, l'enum demanderait une
 * migration) : toute miniature citée par un modèle, de n'importe quelle
 * organisation ou globale, est exclue du ramassage.
 */
const inTemplate = () =>
  sql`exists (select 1 from ${templates} where ${templates.content}::text like '%' || ${media.id}::text || '%')`;

/**
 * Met à la corbeille (jamais de suppression de stockage : la purge reste seule
 * à supprimer) les miniatures de blocs design qu'aucune cible n'utilise depuis
 * au moins 7 jours.
 *
 * Garde de fraîcheur : la preuve d'usage est `media_usages`, alimentée par le
 * balayage différé. Rien n'est ramassé si une source du balayage est en retard
 * ou en échec, et seuls les médias plus anciens que le filigrane des documents
 * sont candidats.
 *
 * Mesure de l'ancienneté : `media.updated_at` (voir `syncContentUsages`).
 */
export async function trashStaleDesignThumbnails(
  now: Date = new Date(),
): Promise<{ trashed: number; skipped?: "sweep-lagging" }> {
  const cutoff = new Date(now.getTime() - STALE_THUMBNAIL_DAYS * DAY_MS);
  const health = await getSweepHealth(now, SWEEP_GRACE_MS);
  if (health.lagging.length > 0) {
    logger.warn({ lagging: health.lagging }, "Ramassage des miniatures suspendu : balayage des usages en retard");
    return { trashed: 0, skipped: "sweep-lagging" };
  }
  const barrier = thumbnailBarrier(cutoff, health.documentsWatermark);

  let trashed = 0;
  let lastId: string | null = null;
  for (;;) {
    const candidates: { id: string; organizationId: string; updatedAt: Date }[] = await db
      .select({ id: media.id, organizationId: media.organizationId, updatedAt: media.updatedAt })
      .from(media)
      .where(
        and(
          eq(media.origin, "studio"),
          eq(media.filename, DESIGN_THUMBNAIL_NAME),
          like(media.storageKey, DESIGN_THUMBNAIL_KEY_PATTERN),
          isNull(media.deletedAt),
          lt(media.updatedAt, barrier),
          sql`not ${inTemplate()}`,
          lastId ? sql`${media.id} > ${lastId}` : undefined,
        ),
      )
      .orderBy(media.id)
      .limit(BATCH);
    if (candidates.length === 0) break;
    lastId = candidates[candidates.length - 1].id;

    const used: { mediaId: string }[] = await db
      .select({ mediaId: mediaUsages.mediaId })
      .from(mediaUsages)
      .where(inArray(mediaUsages.mediaId, candidates.map((c) => c.id)));
    const usedIds = new Set(used.map((u) => u.mediaId));
    const stale = candidates.filter((c) => !usedIds.has(c.id) && c.updatedAt.getTime() < barrier.getTime());

    // Isolation par organisation : un lot par organisation, jamais de mélange.
    const byOrg = new Map<string, string[]>();
    for (const c of stale) byOrg.set(c.organizationId, [...(byOrg.get(c.organizationId) ?? []), c.id]);
    for (const [orgId, ids] of byOrg) {
      // Garde finale dans la requête : usage, modèle ou modification apparus entre-temps l'emportent.
      const done: { id: string }[] = await db
        .update(media)
        .set({ deletedAt: now, deletedBy: null, updatedAt: now })
        .where(
          and(
            inArray(media.id, ids),
            eq(media.organizationId, orgId),
            isNull(media.deletedAt),
            lt(media.updatedAt, barrier),
            sql`not ${inTemplate()}`,
            notExists(db.select({ one: sql`1` }).from(mediaUsages).where(eq(mediaUsages.mediaId, media.id))),
          ),
        )
        .returning({ id: media.id });
      trashed += done.length;
      if (done.length > 0) {
        auditLog("media.thumbnail_trashed", null, {
          organizationId: orgId,
          count: done.length,
          mediaIds: done.map((d) => d.id),
        });
      }
    }
    if (candidates.length < BATCH) break;
  }
  return { trashed };
}
