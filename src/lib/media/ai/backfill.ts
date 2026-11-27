import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import { enqueueMediaIndex } from "./enqueue";

/** Types de média qui ont un extracteur (PDF, bureautique, audio, vidéo, EXIF des images). */
export const INDEXABLE_KINDS = ["pdf", "document", "audio", "video", "image"] as const;
const BATCH = 200;

/**
 * Met en file `backfill` tous les médias indexables de l'organisation (hors corbeille), par lots
 * paginés sur l'identifiant. Idempotent : un média déjà à jour dans la file n'est pas touché.
 * Ne lève jamais (appelé sans attente à l'activation de l'indexation). Rend le nombre de médias vus.
 */
export async function backfillMediaIndex(orgId: string): Promise<number> {
  let seen = 0;
  try {
    const kinds = sql.join(
      INDEXABLE_KINDS.map((k) => sql`${k}`),
      sql`, `,
    );
    let after: string | null = null;
    for (;;) {
      const res: { rows: unknown[] } = await db.execute(
        sql`SELECT id FROM media
            WHERE organization_id = ${orgId} AND deleted_at IS NULL AND kind::text IN (${kinds})
              ${after ? sql`AND id > ${after}` : sql``}
            ORDER BY id LIMIT ${BATCH}`,
      );
      const ids: string[] = (res.rows as Array<{ id: string }>).map((r) => r.id);
      for (const id of ids) await enqueueMediaIndex(id, "backfill");
      seen += ids.length;
      if (ids.length < BATCH) break;
      after = ids[ids.length - 1];
    }
  } catch (err) {
    logger.warn({ module: "media-ai-backfill", orgId, err: String(err) }, "Mise en file de l'existant impossible");
  }
  return seen;
}
