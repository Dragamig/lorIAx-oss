import { NextResponse } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";
import { rowBatchErrorResponse } from "@/lib/databases/row-batch-http";
import { duplicateDatabaseRows } from "@/lib/databases/row-batch";
import { rowContextFromRequest } from "@/lib/databases/row-request-context";
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
