import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaVersions, type Media, type NewMedia } from "@/lib/db/schema";
import { checkUploadQuota, type DbTx, type QuotaVerdict } from "./quota";

export type ReserveInput = {
  orgId: string;
  sizeBytes: number;
  /** Valeurs de la ligne ; `organizationId` et `sizeBytes` sont imposés par la fonction. */
  values: Omit<NewMedia, "organizationId" | "sizeBytes">;
  /**
   * Réécriture d'une clé déjà enregistrée (nouveau rendu d'un export) : met la
   * ligne à jour au lieu d'insérer. Le quota compte alors la différence de taille.
   */
  replaceExisting?: boolean;
  /** Envoi multipart en finalisation : sa réservation ne compte pas deux fois. */
  excludeUploadId?: string;
  /** Appelé dans la transaction, après l'insertion (ex. clore l'envoi multipart). */
  afterInsert?: (tx: DbTx, row: Media) => Promise<void>;
};

export type ReserveResult =
  | {
      ok: true;
      media: Media;
      quota: QuotaVerdict;
      /** Ligne complète avant mise à jour, null si la ligne vient d'être insérée. */
      previous: Media | null;
    }
  | { ok: false; status: 507; error: string; quota: QuotaVerdict };

export function lockOrgQuota(tx: DbTx, orgId: string) {
  return tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"media-quota:" + orgId}))`);
}

/**
 * Défait une réécriture dont l'envoi a échoué : la ligne redécrit exactement
 * l'ancien objet (un PUT S3 qui échoue le laisse en place), sous le même verrou.
 */
export async function restoreMediaRow(previous: Media): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOrgQuota(tx, previous.organizationId);
    await tx
      .update(media)
      .set({
        sizeBytes: previous.sizeBytes,
        checksumSha256: previous.checksumSha256,
        updatedAt: previous.updatedAt,
      })
      .where(eq(media.id, previous.id));
    await tx
      .update(mediaVersions)
      .set({ sizeBytes: previous.sizeBytes, checksumSha256: previous.checksumSha256 })
      .where(and(eq(mediaVersions.mediaId, previous.id), eq(mediaVersions.version, previous.currentVersion)));
  });
}

/**
 * Section critique du quota : verrou consultatif par organisation, contrôle du
 * quota et ligne `media` dans la même transaction, AVANT tout envoi S3.
 * Aucune suppression d'objet : l'appelant défait au plus la ligne.
 */
export async function reserveMediaRow(input: ReserveInput): Promise<ReserveResult> {
  const { orgId, sizeBytes, values } = input;
  const outcome = await db.transaction(async (tx) => {
    await lockOrgQuota(tx, orgId);

    let existing: Media | undefined;
    if (input.replaceExisting) {
      [existing] = await tx.select().from(media).where(eq(media.storageKey, values.storageKey)).for("update");
      if (existing?.deletedAt) {
        throw new Error("Clé de stockage occupée par un média en corbeille");
      }
      if (existing && existing.organizationId !== orgId) {
        throw new Error("Clé de stockage déjà utilisée par une autre organisation");
      }
    }

    // La clé n'est plus celle d'un média courant : ancienne version d'un média remplacé.
    // On réécrit alors cet objet (ligne de version seule), sans heurter uq_media_versions_storage_key.
    if (input.replaceExisting && !existing) {
      const [oldVersion] = await tx
        .select()
        .from(mediaVersions)
        .where(eq(mediaVersions.storageKey, values.storageKey))
        .for("update");
      if (oldVersion) {
        const [parent] = await tx.select().from(media).where(eq(media.id, oldVersion.mediaId)).for("update");
        if (!parent || parent.deletedAt) throw new Error("Clé de stockage occupée par un média en corbeille");
        if (parent.organizationId !== orgId) {
          throw new Error("Clé de stockage déjà utilisée par une autre organisation");
        }
        const delta = Math.max(sizeBytes - oldVersion.sizeBytes, 0);
        const verdict = await checkUploadQuota(orgId, delta, tx);
        if (!verdict.allowed) return { quota: verdict, row: null, previous: null };
        await tx
          .update(mediaVersions)
          .set({ sizeBytes, checksumSha256: values.checksumSha256 ?? null })
          .where(eq(mediaVersions.id, oldVersion.id));
        return { quota: verdict, row: parent, previous: parent };
      }
    }

    // Réécriture : seul le surplus compte, une réduction passe toujours.
    const incoming = existing ? Math.max(sizeBytes - existing.sizeBytes, 0) : sizeBytes;
    const quota = await checkUploadQuota(orgId, incoming, tx, { excludeUploadId: input.excludeUploadId });
    if (!quota.allowed) return { quota, row: null, previous: null };

    if (existing) {
      const [row] = await tx
        .update(media)
        .set({ sizeBytes, checksumSha256: values.checksumSha256 ?? null, updatedAt: new Date() })
        .where(eq(media.id, existing.id))
        .returning();
      // La version courante redécrit le même objet réécrit.
      await tx
        .update(mediaVersions)
        .set({ sizeBytes, checksumSha256: values.checksumSha256 ?? null })
        .where(and(eq(mediaVersions.mediaId, existing.id), eq(mediaVersions.version, existing.currentVersion)));
      return { quota, row, previous: existing };
    }

    const [row] = await tx
      .insert(media)
      .values({ ...values, organizationId: orgId, sizeBytes })
      .returning();
    // Version 1, dans la même transaction que la ligne `media`.
    await tx.insert(mediaVersions).values({
      mediaId: row.id,
      version: 1,
      storageKey: row.storageKey,
      thumbnailKey: row.thumbnailKey,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      checksumSha256: row.checksumSha256,
      width: row.width,
      height: row.height,
      pageCount: row.pageCount,
      createdBy: row.uploadedBy,
    });
    if (input.afterInsert) await input.afterInsert(tx, row);
    return { quota, row, previous: null };
  });

  if (!outcome.row) {
    return { ok: false, status: 507, error: "Quota de stockage atteint", quota: outcome.quota };
  }
  return { ok: true, media: outcome.row, quota: outcome.quota, previous: outcome.previous };
}
