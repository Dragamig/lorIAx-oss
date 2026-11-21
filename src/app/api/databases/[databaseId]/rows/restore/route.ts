import { NextResponse } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { restoreDatabaseRows } from "@/lib/databases/row-batch";
import { rowBatchErrorResponse } from "@/lib/databases/row-batch-http";
import { canTargetRelationDatabase } from "@/lib/databases/relation-target-access";
import type { RowChangeContext } from "@/lib/databases/row-change-context";
import { MediaCellError } from "@/lib/databases/attachment-cell-guard";
import { z } from "zod";

const schema = z.object({
  rows: z
    .array(
      z.object({
        id: z.string().uuid(),
        cells: z.record(z.string(), z.any()),
        position: z.number().int().min(0).max(1_000_000),
        tracking: z
          .array(
            z.object({
              mappingId: z.string().uuid(),
              externalRowId: z.string().min(1).max(512),
              contentHash: z.string().max(64).nullable().optional().transform((v) => v ?? null),
              lastExternalChangeAt: z.string().datetime().nullable().optional().transform((v) => v ?? null),
            })
          )
          .max(50)
          .optional(),
      })
    )
    .min(1)
    .max(500),
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

  const ctx: RowChangeContext = {
    source: "restore",
    actorUserId: scope.user.id,
    batchId: crypto.randomUUID(),
    mediaGuard: { user: scope.user, orgId: scope.orgId },
  };
  try {
    const { rows, alreadyRestored } = await restoreDatabaseRows(databaseId, parsed.data.rows, undefined, {
      canAccessRelationTarget: (targetId) => canTargetRelationDatabase(targetId),
    }, ctx);
    return NextResponse.json(alreadyRestored ? { rows, alreadyRestored: true } : { rows });
  } catch (e) {
    if (e instanceof MediaCellError) return NextResponse.json({ error: e.message }, { status: e.status });
    const res = rowBatchErrorResponse(e, { restore: true });
    if (res) return res;
    throw e;
  }
}
