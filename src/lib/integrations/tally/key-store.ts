/**
 * Stockage de la clé d'API Tally par organisation, chiffrée au repos
 * (`@/lib/crypto`, AES-256-GCM). Aucune fonction ne rend la clé à l'extérieur
 * de ce dossier : l'état public se limite à `connected` et au suffixe.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tallyConnections } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { createTallyClient, type TallyClient } from "./client";

export const TALLY_KEY_PATTERN = /^tly-[A-Za-z0-9_-]{8,200}$/;

export function normalizeTallyKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return TALLY_KEY_PATTERN.test(key) ? key : null;
}

export interface TallyConnectionStatus {
  connected: boolean;
  /** Ex. « ••••a1b2 » ; jamais la clé. */
  maskedKey: string | null;
}

export async function getTallyConnectionStatus(orgId: string): Promise<TallyConnectionStatus> {
  const [row] = await db
    .select({ suffix: tallyConnections.keySuffix })
    .from(tallyConnections)
    .where(eq(tallyConnections.organizationId, orgId))
    .limit(1);
  return row ? { connected: true, maskedKey: `••••${row.suffix}` } : { connected: false, maskedKey: null };
}

export async function saveTallyKey(orgId: string, userId: string, key: string): Promise<void> {
  const values = {
    apiKeyEncrypted: encrypt(key),
    keySuffix: key.slice(-4),
    createdBy: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(tallyConnections)
    .values({ organizationId: orgId, ...values })
    .onConflictDoUpdate({ target: tallyConnections.organizationId, set: values });
}

export async function deleteTallyKey(orgId: string): Promise<void> {
  await db.delete(tallyConnections).where(eq(tallyConnections.organizationId, orgId));
}

/** Client Tally de l'organisation, ou null si aucune clé (ou clé illisible). */
export async function getTallyClientForOrg(orgId: string): Promise<TallyClient | null> {
  const [row] = await db
    .select({ enc: tallyConnections.apiKeyEncrypted })
    .from(tallyConnections)
    .where(eq(tallyConnections.organizationId, orgId))
    .limit(1);
  if (!row) return null;
  try {
    return createTallyClient({ apiKey: decrypt(row.enc) });
  } catch {
    return null;
  }
}
