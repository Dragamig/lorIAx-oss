import { and, eq } from "drizzle-orm";
import { databaseRowComments, type RowComment } from "@/lib/db/schema-row-activity";
import { hasPermissionLevel } from "@/lib/auth/rbac";
import type { PermissionLevel } from "@/types";
import { filterEligibleUsers, type CanView } from "./row-eligibility";
import { extractMentionIds, MAX_MENTIONS_PER_COMMENT } from "./row-comment-mentions";
import type { DbExecutor } from "./row-writes";

export type CommentActor = { userId: string; permission: PermissionLevel };

export class RowCommentError extends Error {
  constructor(public readonly code: "not_found" | "forbidden") {
    super(code);
    this.name = "RowCommentError";
  }
}

/** Droits sur un commentaire : modification pour l'auteur seul, suppression et restauration pour l'auteur ou un admin d'espace. */
function commentRights(actor: CommentActor, comment: RowComment) {
  const isAuthor = comment.authorId != null && comment.authorId === actor.userId;
  const canWrite = hasPermissionLevel(actor.permission, "editor");
  return {
    canEdit: isAuthor && canWrite,
    canDelete: (isAuthor && canWrite) || actor.permission === "admin",
  };
}

async function eligibleMentions(
  executor: DbExecutor,
  args: { orgId: string; body: string; canView: CanView },
): Promise<string[]> {
  const ids = extractMentionIds(args.body).slice(0, MAX_MENTIONS_PER_COMMENT);
  return filterEligibleUsers(executor, { orgId: args.orgId, userIds: ids, canView: args.canView });
}

async function loadComment(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string; commentId: string },
): Promise<RowComment> {
  const [row] = await executor
    .select()
    .from(databaseRowComments)
    .where(
      and(
        eq(databaseRowComments.id, args.commentId),
        eq(databaseRowComments.databaseId, args.databaseId),
        eq(databaseRowComments.rowId, args.rowId),
      ),
    )
    .limit(1);
  if (!row) throw new RowCommentError("not_found");
  return row;
}

export async function createRowComment(
  executor: DbExecutor,
  args: {
    databaseId: string;
    rowId: string;
    orgId: string;
    author: CommentActor;
    body: string;
    canView: CanView;
  },
): Promise<{ comment: RowComment; newMentions: string[] }> {
  const mentions = await eligibleMentions(executor, args);
  const [comment] = await executor
    .insert(databaseRowComments)
    .values({
      databaseId: args.databaseId,
      rowId: args.rowId,
      authorId: args.author.userId,
      body: args.body,
      mentions,
    })
    .returning();
  return { comment, newMentions: mentions.filter((id) => id !== args.author.userId) };
}

export async function editRowComment(
  executor: DbExecutor,
  args: {
    databaseId: string;
    rowId: string;
    orgId: string;
    commentId: string;
    actor: CommentActor;
    body: string;
    canView: CanView;
  },
): Promise<{ comment: RowComment; newMentions: string[] }> {
  const existing = await loadComment(executor, args);
  if (existing.deletedAt != null) throw new RowCommentError("not_found");
  if (!commentRights(args.actor, existing).canEdit) throw new RowCommentError("forbidden");
  const mentions = await eligibleMentions(executor, args);
  const previous = new Set(existing.mentions);
  const [comment] = await executor
    .update(databaseRowComments)
    .set({ body: args.body, mentions, editedAt: new Date() })
    .where(
      and(
        eq(databaseRowComments.id, existing.id),
        eq(databaseRowComments.databaseId, args.databaseId),
        eq(databaseRowComments.rowId, args.rowId),
      ),
    )
    .returning();
  return {
    comment,
    newMentions: mentions.filter((id) => !previous.has(id) && id !== args.actor.userId),
  };
}

async function setDeleted(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string; commentId: string; actor: CommentActor },
  deleted: boolean,
): Promise<RowComment> {
  const existing = await loadComment(executor, args);
  if (!commentRights(args.actor, existing).canDelete) throw new RowCommentError("forbidden");
  if ((existing.deletedAt != null) === deleted) return existing;
  const [comment] = await executor
    .update(databaseRowComments)
    .set({ deletedAt: deleted ? new Date() : null })
    .where(
      and(
        eq(databaseRowComments.id, existing.id),
        eq(databaseRowComments.databaseId, args.databaseId),
        eq(databaseRowComments.rowId, args.rowId),
      ),
    )
    .returning();
  return comment;
}

export function deleteRowComment(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string; commentId: string; actor: CommentActor },
): Promise<RowComment> {
  return setDeleted(executor, args, true);
}

export function restoreRowComment(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string; commentId: string; actor: CommentActor },
): Promise<RowComment> {
  return setDeleted(executor, args, false);
}
