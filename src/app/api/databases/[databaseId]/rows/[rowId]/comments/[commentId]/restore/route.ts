import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { restoreRowComment } from "@/lib/databases/row-comments";
import { commentErrorResponse, isUuid, notFoundResponse } from "@/lib/databases/row-comment-route-utils";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ databaseId: string; rowId: string; commentId: string }> }
) {
  const { databaseId, rowId, commentId } = await params;
  const scope = await requireRowScope(request, { databaseId, rowId, min: "editor" });
  if (scope instanceof NextResponse) return scope;
  if (!isUuid(commentId)) return notFoundResponse();

  try {
    const comment = await restoreRowComment(db, {
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
