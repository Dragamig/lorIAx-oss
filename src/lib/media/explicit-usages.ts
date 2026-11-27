import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaUsages } from "@/lib/db/schema-media";
import { getMediaForAccess, resolveMediaAccess } from "@/lib/media/access";
import type { SessionUser } from "@/types";

export type ExplicitUsageInput = {
  user: SessionUser;
  orgId: string;
  targetType: "design" | "whiteboard";
  targetId: string;
  context?: string | null;
  spaceId: string | null;
  mediaIds: string[];
};

/**
 * Remplace l'ensemble des usages `explicit` d'un emplacement (cible + contexte) par `mediaIds`.
 * Pour les contenus que le serveur ne peut pas lire (design stocké sur S3, tableau blanc), le client
 * déclare ses médias à la sauvegarde. Les lignes `content` ne sont jamais touchées. Tout média hors
 * organisation, inexistant ou illisible pour l'utilisateur est ignoré (aucune fuite d'existence).
 */
export async function setExplicitUsages(
  input: ExplicitUsageInput,
): Promise<{ added: number; removed: number; ignored: number }> {
  const { user, orgId, targetType, targetId, spaceId } = input;
  const context = input.context ?? null;

  const wanted = new Set<string>();
  let ignored = 0;
  for (const id of new Set(input.mediaIds.map((m) => m.toLowerCase()))) {
    const row = await getMediaForAccess(id);
    if (!row || row.organizationId !== orgId) {
      ignored += 1;
      continue;
    }
    const verdict = await resolveMediaAccess(user, row, "read", { orgId });
    if (!verdict.allowed) {
      ignored += 1;
      continue;
    }
    wanted.add(row.id);
  }

  const existing: { id: string; mediaId: string }[] = await db
    .select({ id: mediaUsages.id, mediaId: mediaUsages.mediaId })
    .from(mediaUsages)
    .where(
      and(
        eq(mediaUsages.targetType, targetType),
        eq(mediaUsages.targetId, targetId),
        eq(mediaUsages.source, "explicit"),
        sql`coalesce(${mediaUsages.context}, '') = ${context ?? ""}`,
      ),
    );

  const existingIds = new Set(existing.map((e) => e.mediaId));
  const toAdd = [...wanted].filter((id) => !existingIds.has(id));
  const removed = existing.filter((e) => !wanted.has(e.mediaId));

  if (toAdd.length > 0) {
    await db
      .insert(mediaUsages)
      .values(
        toAdd.map((mediaId) => ({ mediaId, targetType, targetId, context, source: "explicit" as const, spaceId })),
      )
      .onConflictDoNothing();
  }
  if (removed.length > 0) {
    await db
      .delete(mediaUsages)
      .where(and(inArray(mediaUsages.id, removed.map((e) => e.id)), eq(mediaUsages.source, "explicit")));
    // Date de dernière utilisation connue (ramassage des médias sans usage), comme syncContentUsages.
    await db.update(media).set({ updatedAt: new Date() }).where(inArray(media.id, removed.map((e) => e.mediaId)));
  }

  return { added: toAdd.length, removed: removed.length, ignored };
}
