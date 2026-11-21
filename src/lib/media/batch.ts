import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaFolders, mediaTagLinks } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { resolveMediaAccess, type MediaAccessRow } from "@/lib/media/access";
import { canWriteLibrary } from "@/lib/media/folders";
import { MEDIA_TAGS_MAX, ensureTags } from "@/lib/media/tags";
import type { SessionUser } from "@/types";

export const BATCH_MAX_IDS = 200;
const CHUNK = 50;

export type BatchAction =
  | { action: "move"; ids: string[]; folderId: string | null }
  | { action: "tag"; ids: string[]; tags: string[] }
  | { action: "untag"; ids: string[]; tagIds: string[] }
  | { action: "trash"; ids: string[] }
  | { action: "restore"; ids: string[] };

export type BatchItemResult = {
  id: string;
  ok: boolean;
  error?: "forbidden" | "not_found" | "already" | "too_many_tags" | "failed";
  previous?: { folderId?: string | null; deletedAt?: string | null; tagIds?: string[] };
};

export type BatchResult = { results: BatchItemResult[]; succeeded: number; failed: number };

export class BatchError extends Error {
  status: 400 | 403 = 400;
  constructor(message: string, status: 400 | 403 = 400) {
    super(message);
    this.status = status;
    this.name = "BatchError";
  }
}

type Tx = Pick<typeof db, "update" | "insert" | "delete">;
type Planned = { result: BatchItemResult; write?: (tx: Tx) => Promise<unknown> };

const ACTIVITY: Record<BatchAction["action"], string> = {
  move: "media.moved",
  tag: "media.tagged",
  untag: "media.tagged",
  trash: "media.trashed",
  restore: "media.restored",
};

export async function runBatch(
  user: SessionUser,
  orgId: string,
  a: BatchAction
): Promise<BatchResult> {
  if (!Array.isArray(a.ids) || a.ids.length === 0 || a.ids.length > BATCH_MAX_IDS) {
    throw new BatchError(`Entre 1 et ${BATCH_MAX_IDS} médias par lot`);
  }
  const ids = [...new Set(a.ids)];

  let tagIdsToAdd: string[] | null = null;
  const tagLabels = a.action === "tag" ? a.tags : [];
  if (a.action === "move" && a.folderId !== null) {
    const [folder] = await db
      .select({ id: mediaFolders.id })
      .from(mediaFolders)
      .where(and(eq(mediaFolders.id, a.folderId), eq(mediaFolders.organizationId, orgId)))
      .limit(1);
    if (!folder) throw new BadFolder();
  }
  if (a.action === "tag" && !(await canWriteLibrary(user, orgId))) {
    throw new BatchError("Droits insuffisants pour créer des tags", 403);
  }

  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: media.id,
            organizationId: media.organizationId,
            spaceId: media.spaceId,
            uploadedBy: media.uploadedBy,
            deletedAt: media.deletedAt,
            origin: media.origin,
            mimeType: media.mimeType,
            folderId: media.folderId,
          })
          .from(media)
          .where(and(inArray(media.id, ids), eq(media.organizationId, orgId)));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const needTags = a.action === "tag" || a.action === "untag";
  const links =
    needTags && rows.length > 0
      ? await db
          .select({ mediaId: mediaTagLinks.mediaId, tagId: mediaTagLinks.tagId })
          .from(mediaTagLinks)
          .where(
            inArray(
              mediaTagLinks.mediaId,
              rows.map((r) => r.id)
            )
          )
      : [];
  const tagsOf = new Map<string, string[]>();
  for (const l of links) tagsOf.set(l.mediaId, [...(tagsOf.get(l.mediaId) ?? []), l.tagId]);

  const planned: Planned[] = [];
  const now = new Date();
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) {
      planned.push({ result: { id, ok: false, error: "not_found" } });
      continue;
    }
    const access: MediaAccessRow = row;
    const read = await resolveMediaAccess(user, access, "read", { orgId });
    if (!read.allowed) {
      planned.push({ result: { id, ok: false, error: "not_found" } });
      continue;
    }
    const write = await resolveMediaAccess(user, access, "write", { orgId });
    if (!write.allowed) {
      planned.push({ result: { id, ok: false, error: "forbidden" } });
      continue;
    }

    switch (a.action) {
      case "move": {
        const previous = { folderId: row.folderId };
        if (row.folderId === a.folderId) {
          planned.push({ result: { id, ok: true, previous } });
          break;
        }
        const folderId = a.folderId;
        planned.push({
          result: { id, ok: true, previous },
          write: (tx) =>
            tx.update(media).set({ folderId, updatedAt: now }).where(eq(media.id, id)),
        });
        break;
      }
      case "trash": {
        if (row.deletedAt) {
          planned.push({
            result: { id, ok: true, error: "already", previous: { deletedAt: row.deletedAt.toISOString() } },
          });
          break;
        }
        planned.push({
          result: { id, ok: true, previous: { deletedAt: null } },
          write: (tx) =>
            tx
              .update(media)
              .set({ deletedAt: now, deletedBy: user.id, updatedAt: now })
              .where(eq(media.id, id)),
        });
        break;
      }
      case "restore": {
        if (!row.deletedAt) {
          planned.push({ result: { id, ok: true, error: "already", previous: { deletedAt: null } } });
          break;
        }
        planned.push({
          result: { id, ok: true, previous: { deletedAt: row.deletedAt.toISOString() } },
          write: (tx) =>
            tx
              .update(media)
              .set({ deletedAt: null, deletedBy: null, updatedAt: now })
              .where(eq(media.id, id)),
        });
        break;
      }
      case "tag": {
        // Les tags ne sont créés qu'au premier média réellement modifiable.
        tagIdsToAdd ??= (await ensureTags(orgId, tagLabels)).map((t) => t.id);
        const have = tagsOf.get(id) ?? [];
        const toAdd = tagIdsToAdd.filter((t) => !have.includes(t));
        if (have.length + toAdd.length > MEDIA_TAGS_MAX) {
          planned.push({ result: { id, ok: false, error: "too_many_tags", previous: { tagIds: have } } });
          break;
        }
        planned.push({
          result: { id, ok: true, previous: { tagIds: have } },
          write:
            toAdd.length === 0
              ? undefined
              : (tx) =>
                  tx
                    .insert(mediaTagLinks)
                    .values(toAdd.map((tagId) => ({ mediaId: id, tagId })))
                    .onConflictDoNothing(),
        });
        break;
      }
      case "untag": {
        const have = tagsOf.get(id) ?? [];
        const toRemove = a.tagIds.filter((t) => have.includes(t));
        planned.push({
          result: { id, ok: true, previous: { tagIds: have } },
          write:
            toRemove.length === 0
              ? undefined
              : (tx) =>
                  tx
                    .delete(mediaTagLinks)
                    .where(
                      and(eq(mediaTagLinks.mediaId, id), inArray(mediaTagLinks.tagId, toRemove))
                    ),
        });
        break;
      }
    }
  }

  const writers = planned.filter((p) => p.write);
  for (let i = 0; i < writers.length; i += CHUNK) {
    const chunk = writers.slice(i, i + CHUNK);
    try {
      await db.transaction(async (tx) => {
        for (const p of chunk) await p.write!(tx);
      });
    } catch {
      for (const p of chunk) {
        p.result.ok = false;
        p.result.error = "failed";
      }
    }
  }

  const results = planned.map((p) => p.result);
  const succeeded = results.filter((r) => r.ok).length;
  const effective = results.filter((r) => r.ok && r.error !== "already");
  if (effective.length > 0) {
    await logActivity({
      userId: user.id,
      action: ACTIVITY[a.action],
      entityType: "media",
      entityId: effective[0].id,
      metadata: { count: effective.length, ids: effective.map((r) => r.id).slice(0, 50) },
    });
  }
  return { results, succeeded, failed: results.length - succeeded };
}

class BadFolder extends BatchError {
  constructor() {
    super("Dossier introuvable");
  }
}
