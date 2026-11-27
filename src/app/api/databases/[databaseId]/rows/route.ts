import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseRows } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";
import { createDatabaseRow, mergeDatabaseRowCells } from "@/lib/databases/row-writes";
import { deleteDatabaseRows } from "@/lib/databases/row-batch";
import { rowBatchErrorResponse } from "@/lib/databases/row-batch-http";
import { rowContextFromRequest } from "@/lib/databases/row-request-context";
import { validateAttachmentCells } from "@/lib/databases/attachment-cell-guard";
import { validateRelationWrites } from "@/lib/databases/relation-write-guard";
import { z } from "zod";

const createRowSchema = z.object({
  cells: z.record(z.string(), z.any()).optional(),
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

  const body = await request.json();
  const parsed = createRowSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const cells: Record<string, unknown> = { ...(parsed.data.cells ?? {}) };
  const guard = await validateAttachmentCells(databaseId, cells, scope.user, scope.orgId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const relGuard = await validateRelationWrites(databaseId, [{ cells }]);
  if (!relGuard.ok) return NextResponse.json({ error: relGuard.error }, { status: relGuard.status });

  const row = await createDatabaseRow(
    databaseId,
    cells,
    undefined,
    rowContextFromRequest(request, scope.user, { allowImport: true })
  );

  // Fire-and-forget : déclenche les automations row_created
  dispatchRowEvents({
    databaseId,
    rowId: row.id,
    before: null,
    after: row.cells as Record<string, unknown>,
  });

  return NextResponse.json(row, { status: 201 });
}

const updateRowsSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string().uuid(),
      cells: z.record(z.string(), z.any()),
    })
  ),
});

export async function PATCH(
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

  const body = await request.json();
  const parsed = updateRowsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Valeur enregistrée : une pièce déjà en place n'est pas revalidée (autre espace, corbeille).
  const stored = await db
    .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells })
    .from(userDatabaseRows)
    .where(
      and(
        eq(userDatabaseRows.databaseId, databaseId),
        inArray(
          userDatabaseRows.id,
          parsed.data.rows.map((r) => r.id)
        )
      )
    );
  const storedById = new Map(stored.map((r) => [r.id, (r.cells ?? {}) as Record<string, unknown>]));
  for (const row of parsed.data.rows) {
    const guard = await validateAttachmentCells(databaseId, row.cells, scope.user, scope.orgId, storedById.get(row.id));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const relGuard = await validateRelationWrites(
    databaseId,
    parsed.data.rows.map((r) => ({ cells: r.cells, stored: storedById.get(r.id) }))
  );
  if (!relGuard.ok) return NextResponse.json({ error: relGuard.error }, { status: relGuard.status });

  const ctx = rowContextFromRequest(request, scope.user);
  const results = [];
  for (const row of parsed.data.rows) {
    // « Avant » pour value_changed : lu avec la valeur enregistrée du garde (une
    // seule requête pour tout le lot, best-effort hors du merge sous verrou de
    // ligne ; un PATCH concurrent peut le rendre légèrement obsolète, tolérable).
    const beforeCells = storedById.get(row.id) ?? {};

    // Merge atomique sous le verrou de ligne natif Postgres (cf. row-writes).
    const updated = await mergeDatabaseRowCells(databaseId, row.id, row.cells, {}, undefined, ctx);

    if (updated) {
      results.push(updated);
      dispatchRowEvents({
        databaseId,
        rowId: updated.id,
        before: beforeCells,
        after: updated.cells as Record<string, unknown>,
      });
    }
  }

  return NextResponse.json(results);
}

const deleteRowsSchema = z.union([
  z.object({ rowIds: z.array(z.string().uuid()).min(1).max(500) }),
  z.object({ rowId: z.string().uuid() }),
]);

export async function DELETE(
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
  const parsed = deleteRowsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const rowIds = "rowIds" in parsed.data ? parsed.data.rowIds : [parsed.data.rowId];

  // Garde-fou : toutes les lignes doivent appartenir à cette base (404 muet sinon).
  let deleted;
  try {
    deleted = await deleteDatabaseRows(
      databaseId,
      rowIds,
      undefined,
      rowContextFromRequest(request, scope.user)
    );
  } catch (e) {
    const res = rowBatchErrorResponse(e);
    if (res) return res;
    throw e;
  }

  for (const row of deleted) {
    dispatchRowEvents({ databaseId, rowId: row.id, before: row.cells, after: null });
  }

  return NextResponse.json({ ok: true, deleted });
}
