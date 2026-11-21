import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { getHooks } from "@/lib/modules/hooks";

/** Transaction drizzle, dérivée de l'instance `db`. */
export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type QuotaVerdict = {
  allowed: boolean;
  warn: boolean;
  percentAfter: number;
  usedBytes: number;
  limitBytes: number | null;
};

const WARN_THRESHOLD_PERCENT = 80;

/**
 * Octets occupés par l'organisation : versions, corbeille (deleted_at non nul)
 * et médias hors espace compris. Passer `tx` pour lire sous le verrou
 * consultatif de l'appelant.
 */
export async function getOrgStorageUsedBytes(orgId: string, tx?: DbTx): Promise<number> {
  const executor = tx ?? db;
  const rows = await executor
    .select({ total: sql<string>`coalesce(sum(${media.sizeBytes}), 0)` })
    .from(media)
    .where(eq(media.organizationId, orgId));
  return Number(rows[0]?.total ?? 0);
}

/** Verdict pur : bloquant au-delà de la limite, avertissement dès 80 %. */
export function evaluateQuota(
  usedBytes: number,
  incomingBytes: number,
  limitBytes: number | null,
): QuotaVerdict {
  if (limitBytes === null) {
    return { allowed: true, warn: false, percentAfter: 0, usedBytes, limitBytes };
  }
  const after = usedBytes + incomingBytes;
  const percentAfter = limitBytes > 0 ? (after / limitBytes) * 100 : 100;
  return {
    allowed: incomingBytes === 0 || after <= limitBytes,
    warn: percentAfter >= WARN_THRESHOLD_PERCENT,
    percentAfter,
    usedBytes,
    limitBytes,
  };
}

export async function checkUploadQuota(
  orgId: string,
  incomingBytes: number,
  tx?: DbTx,
): Promise<QuotaVerdict> {
  const [usedBytes, limitBytes] = await Promise.all([
    getOrgStorageUsedBytes(orgId, tx),
    getHooks().usage.getOrgStorageLimitBytes(orgId),
  ]);
  return evaluateQuota(usedBytes, incomingBytes, limitBytes);
}
