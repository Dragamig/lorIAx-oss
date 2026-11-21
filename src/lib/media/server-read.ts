import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { readFileBytes } from "@/lib/storage/s3";
import { visibleMediaCondition } from "@/lib/media/list";
import type { SessionUser } from "@/types";

/**
 * Lecture d'octets d'un média côté serveur (rendus, automatismes), sans
 * contexte de requête. Lecture seule : aucune suppression.
 *
 * `user` est obligatoire : le filtre de visibilité complet s'applique toujours
 * (`visibleMediaCondition`, portée « live », espace et confidentialité).
 * Absent, en corbeille, d'une autre organisation ou illisible : `null`.
 */
export async function readMediaBytesForOrg(
  mediaId: string,
  orgId: string,
  user: SessionUser
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const scope = await visibleMediaCondition(user, orgId, "live");

  const [row] = await db
    .select({
      storageKey: media.storageKey,
      mimeType: media.mimeType,
      organizationId: media.organizationId,
      deletedAt: media.deletedAt,
    })
    .from(media)
    .where(and(eq(media.id, mediaId), scope))
    .limit(1);

  if (!row || row.organizationId !== orgId || row.deletedAt) return null;

  try {
    const buffer = await readFileBytes(row.storageKey);
    if (!buffer) return null;
    return { buffer, mimeType: row.mimeType };
  } catch {
    return null;
  }
}
