import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaAiSettings, mediaEmbeddings, mediaTexts } from "@/lib/db/schema";
import { INDEXABLE_KINDS } from "./backfill";
import { MAX_CHUNKS } from "./limits";

export type MediaAiSettingsValue = { indexEnabled: boolean; transcribeEnabled: boolean };

export class MediaAiSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaAiSettingsError";
  }
}

/** Absence de ligne = tout désactivé. */
export async function getMediaAiSettings(orgId: string): Promise<MediaAiSettingsValue> {
  const [row] = await db
    .select({
      indexEnabled: mediaAiSettings.indexEnabled,
      transcribeEnabled: mediaAiSettings.transcribeEnabled,
    })
    .from(mediaAiSettings)
    .where(eq(mediaAiSettings.organizationId, orgId))
    .limit(1);
  return { indexEnabled: row?.indexEnabled ?? false, transcribeEnabled: row?.transcribeEnabled ?? false };
}

/** Écrit les interrupteurs de l'organisation. La transcription exige l'indexation. */
export async function setMediaAiSettings(
  orgId: string,
  userId: string,
  patch: Partial<MediaAiSettingsValue>,
): Promise<MediaAiSettingsValue> {
  const current = await getMediaAiSettings(orgId);
  const next: MediaAiSettingsValue = {
    indexEnabled: patch.indexEnabled ?? current.indexEnabled,
    transcribeEnabled: patch.transcribeEnabled ?? current.transcribeEnabled,
  };
  // Désactiver l'indexation coupe aussi la transcription (qui en dépend).
  if (patch.indexEnabled === false && patch.transcribeEnabled === undefined) next.transcribeEnabled = false;
  if (next.transcribeEnabled && !next.indexEnabled) {
    throw new MediaAiSettingsError("La transcription exige l'indexation du texte.");
  }
  await db
    .insert(mediaAiSettings)
    .values({ organizationId: orgId, ...next, updatedBy: userId, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: mediaAiSettings.organizationId,
      set: { ...next, updatedBy: userId, updatedAt: new Date() },
    });
  return next;
}

/** Un bloc d'environ 4 000 octets de source en moyenne : estimation grossière, plafonnée. */
const BYTES_PER_CHUNK_ESTIMATE = 20_000;

export type MediaAiStats = {
  pending: number;
  indexed: number;
  failed: number;
  estimate: { media: number; chunks: number; audioVideo: number };
};

/** Compteurs agrégés de l'organisation, en SQL, sans lecture S3. Hors corbeille. */
export async function getMediaAiStats(orgId: string): Promise<MediaAiStats> {
  const kinds = sql.join(
    INDEXABLE_KINDS.map((k) => sql`${k}`),
    sql`, `,
  );
  const [est] = await db
    .select({
      media: sql<number>`count(*)::int`,
      audioVideo: sql<number>`count(*) filter (where ${media.kind}::text in ('audio','video'))::int`,
      chunks: sql<number>`coalesce(sum(least(${MAX_CHUNKS}, greatest(1, ceil(${media.sizeBytes}::numeric / ${BYTES_PER_CHUNK_ESTIMATE})))), 0)::int`,
    })
    .from(media)
    .where(
      and(
        eq(media.organizationId, orgId),
        sql`${media.deletedAt} is null`,
        sql`${media.kind}::text in (${kinds})`,
      ),
    );
  const [st] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${mediaTexts.status} in ('pending','running'))::int`,
      indexed: sql<number>`count(*) filter (where ${mediaTexts.status} = 'done')::int`,
      failed: sql<number>`count(*) filter (where ${mediaTexts.status} = 'failed')::int`,
    })
    .from(mediaTexts)
    .innerJoin(media, eq(media.id, mediaTexts.mediaId))
    .where(and(eq(mediaTexts.organizationId, orgId), sql`${media.deletedAt} is null`));
  return {
    pending: st?.pending ?? 0,
    indexed: st?.indexed ?? 0,
    failed: st?.failed ?? 0,
    estimate: { media: est?.media ?? 0, chunks: est?.chunks ?? 0, audioVideo: est?.audioVideo ?? 0 },
  };
}

/** Efface texte et vecteurs de la seule organisation donnée. Rend le nombre de textes supprimés. */
export async function clearMediaAiIndex(orgId: string): Promise<number> {
  return db.transaction(async (tx) => {
    // Texte d'abord (même ordre de verrous qu'un worker : media_texts puis vecteurs), la cascade
    // de la clé étrangère emporte les vecteurs ; le second delete couvre une base sans la clé.
    const deleted = await tx
      .delete(mediaTexts)
      .where(eq(mediaTexts.organizationId, orgId))
      .returning({ id: mediaTexts.id });
    await tx.delete(mediaEmbeddings).where(eq(mediaEmbeddings.organizationId, orgId));
    return deleted.length;
  });
}
