import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { isOrgAdminOrOwner } from "@/lib/media/access";
import { InvalidHistoryCursorError } from "@/lib/databases/row-history-read";
import { listRowActivity } from "@/lib/databases/row-activity-read";
import type { RowActivityPage } from "@/lib/databases/row-activity-types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ databaseId: string; rowId: string }> }
) {
  const { databaseId, rowId } = await params;
  // No findRowById: the activity of a deleted row stays readable.
  const scope = await requireRowScope(request, { databaseId, rowId, min: "viewer" });
  if (scope instanceof NextResponse) return scope;

  const search = request.nextUrl.searchParams;
  const limitParam = search.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitParam !== null) {
    if (!/^\d+$/.test(limitParam)) {
      return NextResponse.json({ error: "Limite invalide" }, { status: 400 });
    }
    limit = Number(limitParam);
    if (limit < 1 || limit > MAX_LIMIT) {
      return NextResponse.json({ error: "Limite invalide" }, { status: 400 });
    }
  }
  const cursor = search.get("cursor") || undefined;

  try {
    const [{ items, nextCursor }, canClear] = await Promise.all([
      listRowActivity(db, { databaseId, rowId, orgId: scope.orgId, cursor, limit }),
      isOrgAdminOrOwner(scope.userId, scope.orgId),
    ]);
    const page: RowActivityPage = {
      items,
      nextCursor,
      permission: scope.permission,
      viewerId: scope.userId,
      canClear,
    };
    return NextResponse.json(page);
  } catch (e) {
    if (e instanceof InvalidHistoryCursorError) {
      return NextResponse.json({ error: "Curseur invalide" }, { status: 400 });
    }
    throw e;
  }
}
