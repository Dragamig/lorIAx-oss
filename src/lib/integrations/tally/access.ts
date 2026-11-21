/**
 * Contrôle d'accès commun aux routes Tally : organisation courante, droit de
 * gestion des automatismes (403), cloisonnement par organisation (404 muet).
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { requireOrgScoped, OrgScopeError, type OrgScopedContext } from "@/lib/auth/require-org-scoped";
import { canManageAutomations } from "@/lib/auth/rbac";
import { checkRateLimitAsync } from "@/lib/rate-limit";
import { getOrgIdForAutomation } from "@/lib/automations/executor";
import type { AutomationRow } from "@/lib/automations/actions/types";
import { TallyError } from "./client";

export const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

/** Plafonds par organisation (par minute) des routes qui appellent l'API Tally. */
export const TALLY_LIMITS = {
  forms: 20,
  count: 30,
  imports: 10,
} as const;

/** null = autorisé ; sinon réponse 429. Clé par organisation, jamais par IP. */
export async function tallyRateLimited(orgId: string, bucket: keyof typeof TALLY_LIMITS): Promise<NextResponse | null> {
  const r = await checkRateLimitAsync(`tally:${bucket}:${orgId}`, { maxRequests: TALLY_LIMITS[bucket], windowMs: 60_000 });
  if (r.success) return null;
  return NextResponse.json({ error: "Trop de requêtes, réessayez dans une minute", code: "rate_limited" }, { status: 429 });
}

export async function requireTallyManager(): Promise<{ ctx: OrgScopedContext } | { response: NextResponse }> {
  let ctx: OrgScopedContext;
  try {
    ctx = await requireOrgScoped();
  } catch (e) {
    if (e instanceof OrgScopeError) return { response: e.response };
    throw e;
  }
  if (!canManageAutomations(ctx.user.globalRole, ctx.user.capabilities)) {
    return {
      response: NextResponse.json(
        { error: "Vous n'avez pas le rôle requis pour gérer les automatismes" },
        { status: 403 }
      ),
    };
  }
  return { ctx };
}

/** Automatisme webhook entrant de l'organisation courante, avec droit d'édition sur son espace. */
export async function resolveWebhookAutomation(
  automationId: string
): Promise<{ ctx: OrgScopedContext; automation: AutomationRow } | { response: NextResponse }> {
  const guard = await requireTallyManager();
  if ("response" in guard) return guard;
  if (!/^[0-9a-f-]{36}$/i.test(automationId)) return { response: notFound() };

  const [automation] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(and(eq(userDatabaseAutomations.id, automationId), eq(userDatabaseAutomations.triggerType, "webhook_inbound")))
    .limit(1);
  if (!automation) return { response: notFound() };

  const orgId = await getOrgIdForAutomation(automation);
  if (!orgId || orgId !== guard.ctx.orgId) return { response: notFound() };

  const resource = automation.databaseId
    ? ({ type: "database", id: automation.databaseId } as const)
    : automation.spaceId
      ? ({ type: "space", id: automation.spaceId } as const)
      : null;
  if (!resource) return { response: notFound() };
  try {
    await requireOrgScoped({ resource, minPermission: "editor" });
  } catch (e) {
    if (e instanceof OrgScopeError) return { response: e.response };
    throw e;
  }
  return { ctx: guard.ctx, automation: automation as AutomationRow };
}

/** Traduit une erreur Tally en réponse HTTP (jamais de détail ni de clé). */
export function tallyErrorResponse(err: unknown): NextResponse {
  if (err instanceof TallyError) {
    if (err.kind === "invalid_key") {
      return NextResponse.json({ error: "Clé d'API Tally invalide ou révoquée", code: "invalid_key" }, { status: 422 });
    }
    if (err.kind === "rate_limited") {
      return NextResponse.json({ error: err.message, code: "rate_limited" }, { status: 429 });
    }
    if (err.kind === "not_found") {
      return NextResponse.json({ error: "Formulaire Tally introuvable", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Tally indisponible", code: err.kind }, { status: 502 });
  }
  throw err;
}
