import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { media, mediaUsages, type MediaUsageTarget } from "@/lib/db/schema-media";

export type MediaRef = { mediaId: string } | { storageKey: string };

export type UsageTarget = {
  targetType: MediaUsageTarget;
  targetId: string;
  organizationId: string;
  spaceId: string | null;
  context?: string | null;
};

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
// Le caractère précédent exclut les URL absolues (autre domaine) et les chemins imbriqués.
const NOT_AFTER = "(?<![A-Za-z0-9._~%:\\-])";
const MEDIA_RE = new RegExp(`${NOT_AFTER}/api/media/(${UUID})(?![0-9A-Za-z-])`, "g");
const ATTACHMENT_RE = new RegExp(`${NOT_AFTER}/api/attachments/([^"'()\\s?#<>\\\\\\]]+)`, "g");
const MEDIA_ID_RE = new RegExp(`\\\\?"mediaId\\\\?"\\s*:\\s*\\\\?"(${UUID})\\\\?"`, "g");

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Extraction pure des références médias d'un texte ou d'un objet JSON. */
export function extractMediaRefs(payload: string | object): MediaRef[] {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload) ?? "";
  const ids = new Set<string>();
  const keys = new Set<string>();

  for (const m of text.matchAll(MEDIA_RE)) ids.add(m[1].toLowerCase());
  for (const m of text.matchAll(MEDIA_ID_RE)) ids.add(m[1].toLowerCase());
  for (const m of text.matchAll(ATTACHMENT_RE)) {
    const key = safeDecode(m[1]);
    if (key) keys.add(key);
  }

  return [
    ...[...ids].map((mediaId) => ({ mediaId })),
    ...[...keys].map((storageKey) => ({ storageKey })),
  ];
}

/**
 * Synchronise les usages `content` d'une cible. Seuls les médias de la même
 * organisation sont retenus (jamais d'usage inter-organisation). Les lignes
 * `explicit` ne sont jamais touchées ; les médias en corbeille gardent leurs usages.
 */
export async function syncContentUsages(
  target: UsageTarget,
  refs: MediaRef[],
): Promise<{ added: number; removed: number; ignored: number }> {
  const ids = refs.flatMap((r) => ("mediaId" in r ? [r.mediaId] : []));
  const keys = refs.flatMap((r) => ("storageKey" in r ? [r.storageKey] : []));

  let found: { id: string; organizationId: string; storageKey: string }[] = [];
  if (ids.length > 0 || keys.length > 0) {
    const conds = [];
    if (ids.length > 0) conds.push(inArray(media.id, ids));
    if (keys.length > 0) conds.push(inArray(media.storageKey, keys));
    found = await db
      .select({ id: media.id, organizationId: media.organizationId, storageKey: media.storageKey })
      .from(media)
      .where(or(...conds));
  }

  const byId = new Map(found.map((m) => [m.id, m]));
  const byKey = new Map(found.map((m) => [m.storageKey, m]));
  const wanted = new Set<string>();
  let ignored = 0;
  for (const ref of refs) {
    const m = "mediaId" in ref ? byId.get(ref.mediaId) : byKey.get(ref.storageKey);
    if (m && m.organizationId === target.organizationId) wanted.add(m.id);
    else ignored += 1;
  }

  const context = target.context ?? null;
  const existing = await db
    .select({ id: mediaUsages.id, mediaId: mediaUsages.mediaId })
    .from(mediaUsages)
    .where(
      and(
        eq(mediaUsages.targetType, target.targetType),
        eq(mediaUsages.targetId, target.targetId),
        eq(mediaUsages.source, "content"),
        sql`coalesce(${mediaUsages.context}, '') = ${context ?? ""}`,
      ),
    );

  const existingIds = new Set(existing.map((e) => e.mediaId));
  const toAdd = [...wanted].filter((id) => !existingIds.has(id));
  const toRemove = existing.filter((e) => !wanted.has(e.mediaId)).map((e) => e.id);

  if (toAdd.length > 0) {
    // Sans cible de conflit : couvre l'index d'unicité sur expression, et laisse
    // intacte une ligne `explicit` déjà posée sur le même emplacement.
    await db
      .insert(mediaUsages)
      .values(
        toAdd.map((mediaId) => ({
          mediaId,
          targetType: target.targetType,
          targetId: target.targetId,
          context,
          source: "content" as const,
          spaceId: target.spaceId,
        })),
      )
      .onConflictDoNothing();
  }
  if (toRemove.length > 0) {
    await db
      .delete(mediaUsages)
      .where(and(inArray(mediaUsages.id, toRemove), eq(mediaUsages.source, "content")));
    // Date de dernière utilisation connue : le ramassage des miniatures de
    // design sans usage s'appuie sur `updated_at` (jamais sur une ligne supprimée).
    const removedMediaIds = existing.filter((e) => !wanted.has(e.mediaId)).map((e) => e.mediaId);
    await db.update(media).set({ updatedAt: new Date() }).where(inArray(media.id, removedMediaIds));
  }

  return { added: toAdd.length, removed: toRemove.length, ignored };
}

/** Recalcule les usages d'un document à partir de son texte. */
export async function syncDocumentUsages(documentId: string): Promise<void> {
  const [doc] = await db
    .select({
      contentText: documents.contentText,
      spaceId: documents.spaceId,
      organizationId: spaces.organizationId,
    })
    .from(documents)
    .innerJoin(spaces, eq(spaces.id, documents.spaceId))
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc) return;

  await syncContentUsages(
    {
      targetType: "document",
      targetId: documentId,
      organizationId: doc.organizationId,
      spaceId: doc.spaceId,
    },
    extractMediaRefs(doc.contentText ?? ""),
  );
}
