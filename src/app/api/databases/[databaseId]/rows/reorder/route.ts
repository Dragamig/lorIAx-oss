import { NextResponse } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { rowBatchErrorResponse } from "@/lib/databases/row-batch-http";
import { reorderDatabaseRows } from "@/lib/databases/row-batch";
import { z } from "zod";

const schema = z.object({
  rowIds: z.array(z.string().uuid()).min(1).max(500),
  beforeRowId: z.string().uuid().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;
  try {
    await requireOrgScoped({
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
    const rows = await reorderDatabaseRows(databaseId, parsed.data.rowIds, parsed.data.beforeRowId);
    return NextResponse.json({ rows });
  } catch (e) {
    const res = rowBatchErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
