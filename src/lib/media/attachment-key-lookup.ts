import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema-media";
import { spaces } from "@/lib/db/schema";
import type { LookupResult } from "./rewrite-document-refs";

/**
 * Résout des clés de stockage vers les médias non supprimés lisibles depuis l'espace du
 * document, en une seule requête : même espace, ou espace d'organisation non secret
 * (lisible de tout membre, voir `isOrgWideSpace`). Un média sans espace n'est lisible que
 * de son auteur et des admins : il n'est jamais retenu. Clé non retenue : `missing`.
 */
export function createOrgKeyLookup(
  orgId: string,
  spaceId: string,
): (keys: string[]) => Promise<Map<string, LookupResult>> {
  return async (keys) => {
    const out = new Map<string, LookupResult>();
    if (keys.length === 0) return out;
    const rows = await db
      .select({ id: media.id, storageKey: media.storageKey })
      .from(media)
      .innerJoin(spaces, eq(spaces.id, media.spaceId))
      .where(
        and(
          eq(media.organizationId, orgId),
          eq(spaces.organizationId, orgId),
          isNull(media.deletedAt),
          inArray(media.storageKey, keys),
          or(
            eq(media.spaceId, spaceId),
            and(eq(spaces.type, "organization"), ne(spaces.classification, "secret")),
          ),
        ),
      );
    const seen = new Map<string, string[]>();
    for (const r of rows) seen.set(r.storageKey, [...(seen.get(r.storageKey) ?? []), r.id]);
    for (const key of keys) {
      const ids = seen.get(key) ?? [];
      out.set(
        key,
        ids.length === 0 ? { status: "missing" } : ids.length > 1 ? { status: "ambiguous" } : { status: "found", id: ids[0] },
      );
    }
    return out;
  };
}
