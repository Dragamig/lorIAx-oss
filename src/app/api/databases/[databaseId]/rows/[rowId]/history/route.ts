import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { isOrgAdminOrOwner } from "@/lib/media/access";
import {
  listRowHistory,
  eraseRowHistory,
  isUuid,
  InvalidHistoryCursorError,
} from "@/lib/databases/row-history-read";
import type { RowHistoryPage } from "@/lib/databases/row-history-types";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ databaseId: string; rowId: string }> }
) {
  const { databaseId, rowId } = await params;
  if (!isUuid(databaseId) || !isUuid(rowId)) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

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
    const ctx = await requireOrgScoped(
      { resource: { type: "database", id: databaseId }, minPermission: "viewer" },
      request
    );
    const [{ items, nextCursor }, canClear] = await Promise.all([
      listRowHistory(db, { databaseId, rowId, orgId: ctx.orgId, cursor, limit }),
      isOrgAdminOrOwner(ctx.user.id, ctx.orgId),
    ]);
    const page: RowHistoryPage = { items, nextCursor, canClear };
    return NextResponse.json(page);
  } catch (e) {
    if (e instanceof OrgScopeError) {
      // Same silent 404 for another organization, a missing database or no permission.
      return e.response.status === 403
        ? NextResponse.json({ error: "Introuvable" }, { status: 404 })
        : e.response;
    }
    if (e instanceof InvalidHistoryCursorError) {
      return NextResponse.json({ error: "Curseur invalide" }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ databaseId: string; rowId: string }> }
) {
  const { databaseId, rowId } = await params;
  if (!isUuid(databaseId) || !isUuid(rowId)) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  try {
    const ctx = await requireOrgScoped(
      { resource: { type: "database", id: databaseId }, minPermission: "viewer" },
      request
    );
    if (!(await isOrgAdminOrOwner(ctx.user.id, ctx.orgId))) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
    const result = await eraseRowHistory(db, { databaseId, rowId, userId: ctx.user.id });
    return NextResponse.json({
      erased: result.erased,
      comments: result.comments,
      tasks: result.tasks,
      taskEvents: result.taskEvents,
    });
  } catch (e) {
    if (e instanceof OrgScopeError) {
      return e.response.status === 403
        ? NextResponse.json({ error: "Introuvable" }, { status: 404 })
        : e.response;
    }
    throw e;
  }
}
