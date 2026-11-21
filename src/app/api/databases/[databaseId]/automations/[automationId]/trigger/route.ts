import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations, userDatabaseRows } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { getSetting } from "@/lib/settings/system-settings";
import { executeAutomation } from "@/lib/automations/executor";

type RouteParams = { params: Promise<{ databaseId: string; automationId: string }> };

/**
 * Déclenchement manuel d'une automation (bloc éditeur `/bouton`, C3).
 *
 * Contrairement à PATCH/DELETE, on NE requiert PAS `canManageAutomations` :
 * déclencher une automation existante n'est pas la (re)configurer. Tout éditeur
 * de la base peut donc cliquer le bouton. Le débordement est borné par les
 * quotas de `executeAutomation` (1/min par automation, 100/h par org).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { databaseId, automationId } = await params;

  // Test optionnel sur un enregistrement précis : charge ses cellules pour que
  // les conditions et {{cells.*}} soient évaluées sur de vraies données.
  const body = (await request.json().catch(() => ({}))) as { rowId?: string };

  try {
    await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Kill-switch global, cohérent avec POST/PATCH.
  const automationsCfg = await getSetting<{ enabled?: boolean }>("automations");
  if (automationsCfg && automationsCfg.enabled === false) {
    return NextResponse.json(
      { error: "Les automatisations sont désactivées globalement par l'administrateur" },
      { status: 403 }
    );
  }

  // L'automation doit appartenir à cette database.
  const [automation] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        eq(userDatabaseAutomations.databaseId, databaseId)
      )
    )
    .limit(1);
  if (!automation) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  if (!automation.enabled) {
    return NextResponse.json({ error: "Automatisation désactivée" }, { status: 409 });
  }

  let rowId: string | undefined;
  let cells: Record<string, unknown> = {};
  if (body.rowId) {
    const [row] = await db
      .select({ id: userDatabaseRows.id, cells: userDatabaseRows.cells })
      .from(userDatabaseRows)
      .where(and(eq(userDatabaseRows.id, body.rowId), eq(userDatabaseRows.databaseId, databaseId)))
      .limit(1);
    if (row) {
      rowId = row.id;
      cells = (row.cells ?? {}) as Record<string, unknown>;
    }
  }

  const result = await executeAutomation(automation, {
    event: "manual",
    databaseId,
    rowId,
    cells,
  });

  if (result.status === "error") {
    return NextResponse.json({ status: "error", error: result.error, steps: result.steps }, { status: 502 });
  }
  if (result.status === "skipped") {
    return NextResponse.json(
      { status: "skipped", error: result.error },
      { status: 429 }
    );
  }
  return NextResponse.json({ status: "success", durationMs: result.durationMs, steps: result.steps });
}
