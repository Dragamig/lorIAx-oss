import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { makeCanView } from "@/lib/databases/row-eligibility";
import { editRowComment, deleteRowComment } from "@/lib/databases/row-comments";
import { validateCommentBody } from "@/lib/databases/row-comment-mentions";
import { notifyRowMentions } from "@/lib/databases/row-comment-notify";
import {
  commentErrorResponse,
  invalidCommentResponse,
  isUuid,
  notFoundResponse,
  readJsonBody,
} from "@/lib/databases/row-comment-route-utils";

type Ctx = { params: Promise<{ databaseId: string; rowId: string; commentId: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { databaseId, rowId, commentId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "editor" });
  if (scope instanceof NextResponse) return scope;
  if (!isUuid(commentId)) return notFoundResponse();

  const json = (await readJsonBody(request)) as { body?: unknown } | undefined;
  const parsed = validateCommentBody(json?.body);
  if (!parsed.ok) return invalidCommentResponse();

  try {
    const { comment, newMentions } = await editRowComment(db, {
      databaseId,
      rowId,
      orgId: scope.orgId,
      commentId,
      actor: { userId: scope.userId, permission: scope.permission },
      body: parsed.body,
      canView: makeCanView(scope.spaceId),
    });
    // L'ecriture est faite : un echec de notification ne doit pas la transformer en 500.
    try {
      await notifyRowMentions({
        userIds: newMentions,
        actorId: scope.userId,
        actorName: scope.userName,
        databaseId,
        rowId,
      });
    } catch (err) {
      logger.error({ err, databaseId, rowId }, "[row-comments] notification de mention impossible");
    }
    return NextResponse.json({ comment });
  } catch (e) {
    return commentErrorResponse(e);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { databaseId, rowId, commentId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "editor" });
  if (scope instanceof NextResponse) return scope;
  if (!isUuid(commentId)) return notFoundResponse();

  try {
    const comment = await deleteRowComment(db, {
      databaseId,
      rowId,
      commentId,
      actor: { userId: scope.userId, permission: scope.permission },
    });
    return NextResponse.json({ comment });
  } catch (e) {
    return commentErrorResponse(e);
  }
}
