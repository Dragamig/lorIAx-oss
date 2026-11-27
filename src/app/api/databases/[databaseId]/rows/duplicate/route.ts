import { NextResponse } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";
import { rowBatchErrorResponse } from "@/lib/databases/row-batch-http";
import { duplicateDatabaseRows } from "@/lib/databases/row-batch";
import { rowContextFromRequest } from "@/lib/databases/row-request-context";
import { validateRelationWrites } from "@/lib/databases/relation-write-guard";
import { db } from "@/lib/db";
import { userDatabaseRows } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  rowIds: z.array(z.string().uuid()).min(1).max(500),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;
  let scope: Awaited<ReturnType<typeof requireOrgScoped>>;
  try {
    scope = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // La copie reprend les relations de la source : l'inverse est écrit dans la base cible.
  const sources = await db
    .select({ cells: userDatabaseRows.cells })
    .from(userDatabaseRows)
    .where(and(eq(userDatabaseRows.databaseId, databaseId), inArray(userDatabaseRows.id, parsed.data.rowIds)));
  const relGuard = await validateRelationWrites(
    databaseId,
    sources.map((r) => ({ cells: (r.cells ?? {}) as Record<string, unknown> }))
  );
  if (!relGuard.ok) return NextResponse.json({ error: relGuard.error }, { status: relGuard.status });

  try {
    const rows = await duplicateDatabaseRows(
      databaseId,
      parsed.data.rowIds,
      undefined,
      rowContextFromRequest(request, scope.user)
    );
    for (const row of rows) {
      dispatchRowEvents({ databaseId, rowId: row.id, before: null, after: row.cells });
    }
    return NextResponse.json({ rows });
  } catch (e) {
    const res = rowBatchErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
