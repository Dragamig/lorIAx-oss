import { and, eq, isNull } from "drizzle-orm";
import { media, type Media } from "@/lib/db/schema";

/**
 * Images du studio et de l'admin, stockées dans `media` avec `origin = 'studio'`
 * (la migration 0052 a copié `studio_images` avec les mêmes identifiants).
 */
export function studioImageScope(orgId: string) {
  return and(
    eq(media.organizationId, orgId),
    eq(media.origin, "studio"),
    isNull(media.deletedAt)
  );
}

/** Forme historique d'une ligne `studio_images`, conservée pour les clients. */
export function toStudioImage(row: Media) {
  return {
    id: row.id,
    name: row.filename,
    s3Key: row.storageKey,
    contentType: row.mimeType,
    sizeBytes: row.sizeBytes,
    organizationId: row.organizationId,
    spaceId: row.spaceId,
    createdBy: row.uploadedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
