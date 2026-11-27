import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import logger from "@/lib/logger";
import { extractableKind } from "./extract";

export type EnqueueTrigger = "ingest" | "replace" | "restore" | "backfill" | "manual";

/**
 * Met un média en file d'indexation IA (une ligne `media_texts` par média). Ne lève jamais :
 * un échec ne doit pas faire échouer l'ingestion, le remplacement ou la restauration.
 *
 * - type sans extracteur (archive, .doc binaire...) ou média en corbeille : rien ;
 * - première mise en file : ligne `pending` ;
 * - remplacement, restauration ou version indexée différente de la courante : texte et vecteurs
 *   périmés supprimés dans la même transaction, ligne remise à `pending` ;
 * - `manual` : remise à `pending` sans effacer l'ancien texte (il reste servi jusqu'au succès) ;
 *   sans effet sur une ligne `running` (sinon un second exécuteur la reprendrait en parallèle) ;
 * - `ingest` et `backfill` sur une ligne à jour : sans effet (idempotent).
 */
export async function enqueueMediaIndex(mediaId: string, trigger: EnqueueTrigger): Promise<void> {
  try {
    const [m] = await db
      .select({
        id: media.id,
        organizationId: media.organizationId,
        mimeType: media.mimeType,
        filename: media.filename,
        currentVersion: media.currentVersion,
        deletedAt: media.deletedAt,
      })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1);
    if (!m || m.deletedAt) return;
    if (!extractableKind(m.mimeType, m.filename)) return;

    await db.transaction(async (tx) => {
      const found = await tx.execute(sql`SELECT version, status FROM media_texts WHERE media_id = ${m.id} FOR UPDATE`);
      const existing = (found.rows as Array<{ version: number; status: string }>)[0];
      if (!existing) {
        await tx.execute(
          sql`INSERT INTO media_texts (media_id, organization_id, status, version)
              VALUES (${m.id}, ${m.organizationId}, 'pending', ${m.currentVersion})
              ON CONFLICT (media_id) DO NOTHING`,
        );
        return;
      }
      const stale = trigger === "replace" || trigger === "restore" || existing.version !== m.currentVersion;
      if (stale) {
        await tx.execute(sql`DELETE FROM media_embeddings WHERE media_id = ${m.id}`);
        await tx.execute(
          sql`UPDATE media_texts SET status = 'pending', reason = NULL, source = NULL, text = NULL,
                text_chars = 0, truncated = false, version = ${m.currentVersion}, attempts = 0,
                next_attempt_at = now(), locked_at = NULL, indexed_at = NULL, updated_at = now()
              WHERE media_id = ${m.id}`,
        );
        return;
      }
      // Ligne déjà prise par un exécuteur : la remettre en pending la ferait reprendre en parallèle.
      if (trigger === "manual" && existing.status !== "running") {
        await tx.execute(
          sql`UPDATE media_texts SET status = 'pending', reason = NULL, attempts = 0,
                next_attempt_at = now(), locked_at = NULL, updated_at = now()
              WHERE media_id = ${m.id}`,
        );
      }
    });
  } catch (err) {
    logger.warn({ module: "media-ai-enqueue", mediaId, trigger, err: String(err) }, "Mise en file de l'indexation IA impossible");
  }
}
