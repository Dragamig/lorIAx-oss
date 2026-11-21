import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crmConnections } from "@/lib/db/schema-crm";
import { OrgScopeError, requireOrgScoped } from "@/lib/auth/require-org-scoped";
import { guardModuleEnabled } from "@/lib/modules/guard";
import { canCrossOrgBoundary, hasGlobalRole } from "@/lib/auth/rbac";
import { hasOrgMembershipRow } from "@/lib/org/resolve-request-org";
import type { SessionUser } from "@/types";

export type CrmAccess =
  | { ok: true; user: SessionUser; orgId: string; isAdmin: boolean; enabled: boolean }
  | { ok: false; response: NextResponse };

/**
 * Admin de l'organisation : franchissement de frontière (super_admin) OU rôle
 * admin avec une vraie ligne d'appartenance. Jamais `isOrgMember`, qui ouvre
 * l'organisation par défaut à tout compte.
 */
export async function isCrmOrgAdmin(
  user: { id: string; globalRole: string },
  orgId: string
): Promise<boolean> {
  const role = user.globalRole as SessionUser["globalRole"];
  if (canCrossOrgBoundary(role)) return true;
  return hasGlobalRole(role, "admin") && (await hasOrgMembershipRow(user.id, orgId));
}

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

/**
 * Ordre fixe : session (401), organisation de la requête (404), module (404),
 * connexion activée (404), puis rôle (403). Le 403 vient après les 404 pour
 * qu'un non-admin ne distingue pas une organisation sans module d'une autre.
 */
export async function requireCrm(
  opts: { level: "member" | "admin"; requireEnabled: boolean },
  req?: NextRequest
): Promise<CrmAccess> {
  let ctx;
  try {
    ctx = await requireOrgScoped({}, req);
  } catch (e) {
    if (e instanceof OrgScopeError) return { ok: false, response: e.response };
    throw e;
  }
  const { user, orgId } = ctx;

  const blocked = await guardModuleEnabled("crm", orgId);
  if (blocked) return { ok: false, response: notFound() };

  const [row] = await db
    .select({ enabled: crmConnections.enabled })
    .from(crmConnections)
    .where(eq(crmConnections.organizationId, orgId))
    .limit(1);
  const enabled = row?.enabled === true;
  if (opts.requireEnabled && !enabled) return { ok: false, response: notFound() };

  const isAdmin = await isCrmOrgAdmin(user, orgId);
  if (opts.level === "admin" && !isAdmin) {
    return { ok: false, response: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
  }
  return { ok: true, user, orgId, isAdmin, enabled };
}
