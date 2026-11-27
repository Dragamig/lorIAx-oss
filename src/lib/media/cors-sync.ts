import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import logger from "@/lib/logger";
import { ensureBucketCors } from "@/lib/storage/s3";

/**
 * Remet à jour la règle CORS du bucket avec les organisations actives (une
 * origine exacte par organisation). Idempotent et non bloquant : une erreur est
 * journalisée, jamais propagée. À appeler après la création d'une organisation
 * ou un changement de slug ou d'activation, sans l'attendre.
 */
export async function syncBucketCors(): Promise<void> {
  if (!process.env.S3_ENDPOINT || !process.env.S3_PUBLIC_URL) return;
  try {
    const rows = await db.select({ slug: organizations.slug }).from(organizations).where(eq(organizations.isActive, true));
    await ensureBucketCors(rows.map((r) => r.slug));
  } catch (err) {
    logger.warn({ err }, "CORS du bucket non mis à jour");
  }
}
