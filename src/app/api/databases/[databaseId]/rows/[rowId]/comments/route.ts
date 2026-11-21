import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import logger from "@/lib/logger";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { findRowById } from "@/lib/databases/row-writes";
import { makeCanView } from "@/lib/databases/row-eligibility";
import { createRowComment } from "@/lib/databases/row-comments";
import { validateCommentBody } from "@/lib/databases/row-comment-mentions";
import { notifyRowMentions } from "@/lib/databases/row-comment-notify";
import {
  commentErrorResponse,
  invalidCommentResponse,
  notFoundResponse,
  readJsonBody,
} from "@/lib/databases/row-comment-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ databaseId: string; rowId: string }> }
) {
  const { databaseId, rowId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "editor" });
  if (scope instanceof NextResponse) return scope;

  const row = await findRowById(databaseId, rowId);
  if (!row) return notFoundResponse();

  const json = (await readJsonBody(request)) as { body?: unknown } | undefined;
  const parsed = validateCommentBody(json?.body);
  if (!parsed.ok) return invalidCommentResponse();

  try {
    const { comment, newMentions } = await createRowComment(db, {
      databaseId,
      rowId,
      orgId: scope.orgId,
      author: { userId: scope.userId, permission: scope.permission },
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
    return NextResponse.json({ comment }, { status: 201 });
  } catch (e) {
    return commentErrorResponse(e);
  }
}
