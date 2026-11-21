import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, spaces } from "@/lib/db/schema";
import { visibleMediaCondition } from "@/lib/media/list";
import type { SessionUser } from "@/types";

export const DUPLICATE_CHECKSUMS_MAX = 100;
export const CHECKSUM_RE = /^[0-9a-f]{64}$/;

export type DuplicateHit = {
  id: string;
  filename: string;
  spaceName: string | null;
  thumbnailUrl: string | null;
};

/**
 * Médias déjà présents pour des sommes SHA-256 données, limités à ce que
 * l'utilisateur peut lire (hors corbeille). Un résultat par somme, le plus récent.
 * Proposition de réutilisation seulement : aucune fusion automatique.
 */
export async function findDuplicates(
  user: SessionUser,
  orgId: string,
  checksums: string[]
): Promise<Record<string, DuplicateHit>> {
  const unique = [...new Set(checksums)];
  if (unique.length === 0) return {};
  const visible = await visibleMediaCondition(user, orgId, "live");
  const rows = await db
    .select({
      id: media.id,
      filename: media.filename,
      checksum: media.checksumSha256,
      thumbnailKey: media.thumbnailKey,
      spaceName: spaces.name,
    })
    .from(media)
    .leftJoin(spaces, eq(spaces.id, media.spaceId))
    .where(and(visible, inArray(media.checksumSha256, unique)))
    .orderBy(desc(media.createdAt), desc(media.id));

  const out: Record<string, DuplicateHit> = {};
  for (const r of rows) {
    if (!r.checksum || out[r.checksum]) continue;
    out[r.checksum] = {
      id: r.id,
      filename: r.filename,
      spaceName: r.spaceName ?? null,
      thumbnailUrl: r.thumbnailKey ? `/api/media/${r.id}/thumbnail` : null,
    };
  }
  return out;
}
