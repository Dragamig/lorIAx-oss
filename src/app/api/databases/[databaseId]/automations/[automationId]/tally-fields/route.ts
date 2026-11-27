import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { tallyFieldsFromBody } from "@/lib/automations/webhook-inbound";

type RouteParams = { params: Promise<{ databaseId: string; automationId: string }> };

/**
 * Champs (key, label, type) de la dernière réponse Tally reçue par l'automatisme,
 * pour configurer `tallyFieldMap`. Le corps reçu n'est lisible que par qui gère
 * l'automatisme (il est masqué aux lecteurs) : même droit que le PATCH.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { databaseId, automationId } = await params;
  let ctx;
  try {
    ctx = await requireOrgScoped({
      resource: { type: "database", id: databaseId },
      minPermission: "editor",
    });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return NextResponse.json(
      { error: "Vous n'avez pas le rôle requis pour configurer une automatisation" },
      { status: 403 }
    );
  }

  const [automation] = await db
    .select({ triggerConfig: userDatabaseAutomations.triggerConfig })
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.id, automationId),
        eq(userDatabaseAutomations.databaseId, databaseId)
      )
    )
    .limit(1);
  if (!automation) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const last = (automation.triggerConfig as { lastReceived?: { body?: unknown } } | null)?.lastReceived;
  return NextResponse.json({ fields: tallyFieldsFromBody(last?.body) });
}
