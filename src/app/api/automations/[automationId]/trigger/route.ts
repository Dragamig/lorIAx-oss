import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations, documents } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import { getSetting } from "@/lib/settings/system-settings";
import { executeAutomation } from "@/lib/automations/executor";
import type { AutomationRow } from "@/lib/automations/actions/types";
import { z } from "zod";

type RouteParams = { params: Promise<{ automationId: string }> };

const bodySchema = z.object({
  // documentId optionnel : le bouton peut être hors éditeur monté (R3). Le
  // serveur tolère son absence et n'interpole alors pas {{doc.id}}.
  documentId: z.string().uuid().optional(),
});

/**
 * Déclenchement manuel d'un workflow AUTONOME (bloc bouton dans un document).
 *
 * Scoping par l'espace du workflow (databaseId null). Comme pour les
 * automatisations base-liées, on NE requiert PAS `canManageAutomations` :
 * déclencher ≠ configurer ; tout éditeur de l'espace peut cliquer le bouton. Le
 * débordement est borné par les quotas de `executeAutomation` (1/min, 100/h org).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { automationId } = await params;

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // L'automation doit être un workflow autonome (databaseId null + spaceId).
  const [automation] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        isNull(userDatabaseAutomations.databaseId)
      )
    )
    .limit(1);
  if (!automation || !automation.spaceId) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  // Accès editor à l'espace du workflow.
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "space", id: automation.spaceId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  // Kill-switch global, cohérent avec les routes base-liées.
  const automationsCfg = await getSetting<{ enabled?: boolean }>("automations");
  if (automationsCfg && automationsCfg.enabled === false) {
    return NextResponse.json(
      { error: "Les automatisations sont désactivées globalement par l'administrateur" },
      { status: 403 }
    );
  }

  if (!automation.enabled) {
    return NextResponse.json({ error: "Workflow désactivé" }, { status: 409 });
  }

  // Le documentId est une entrée d'exécution : il alimente `{{doc.id}}`
  // (interpolate.ts) et sert de document par défaut aux actions (create_task).
  // Un identifiant forgé permettrait donc de rattacher des données à un
  // document hors de portée de l'utilisateur : accès en lecture exigé.
  if (parsed.data.documentId) {
    const [linkedDoc] = await db
      .select({ spaceId: documents.spaceId })
      .from(documents)
      .where(eq(documents.id, parsed.data.documentId))
      .limit(1);
    if (!linkedDoc) {
      return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
    }
    const canViewDoc = await checkDocumentViewAccess(
      ctx.user,
      linkedDoc.spaceId,
      parsed.data.documentId
    );
    if (!canViewDoc) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }
  }

  const result = await executeAutomation(automation as AutomationRow, {
    event: "manual",
    spaceId: automation.spaceId,
    documentId: parsed.data.documentId,
    user: { id: ctx.user.id, email: ctx.user.email, name: ctx.user.name },
  });

  if (result.status === "error") {
    return NextResponse.json({ status: "error", error: result.error, steps: result.steps }, { status: 502 });
  }
  if (result.status === "skipped") {
    return NextResponse.json({ status: "skipped", error: result.error }, { status: 429 });
  }
  return NextResponse.json({ status: "success", durationMs: result.durationMs, steps: result.steps });
}
