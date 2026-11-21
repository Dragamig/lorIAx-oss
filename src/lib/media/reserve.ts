import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, type Media, type NewMedia } from "@/lib/db/schema";
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

function lockOrgQuota(tx: DbTx, orgId: string) {
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

    // Réécriture : seul le surplus compte, une réduction passe toujours.
    const incoming = existing ? Math.max(sizeBytes - existing.sizeBytes, 0) : sizeBytes;
    const quota = await checkUploadQuota(orgId, incoming, tx);
    if (!quota.allowed) return { quota, row: null, previous: null };

    if (existing) {
      const [row] = await tx
        .update(media)
        .set({ sizeBytes, checksumSha256: values.checksumSha256 ?? null, updatedAt: new Date() })
        .where(eq(media.id, existing.id))
        .returning();
      return { quota, row, previous: existing };
    }

    const [row] = await tx
      .insert(media)
      .values({ ...values, organizationId: orgId, sizeBytes })
      .returning();
    return { quota, row, previous: null };
  });

  if (!outcome.row) {
    return { ok: false, status: 507, error: "Quota de stockage atteint", quota: outcome.quota };
  }
  return { ok: true, media: outcome.row, quota: outcome.quota, previous: outcome.previous };
}
