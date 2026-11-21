import { headers } from "next/headers";
import { resolveRequestOrg } from "./resolve-request-org";
import { canCrossOrgBoundary } from "@/lib/auth/rbac";
import type { UserRole } from "@/types";

/**
 * Résout l'`orgId` de la requête courante depuis le sous-domaine
 * (header `x-org-slug` injecté par le middleware) pour un contexte session
 * (route handler ou server component).
 *
 * Applique le même contrôle d'appartenance que {@link resolveRequestOrg} :
 * une org isolée n'est résolue que si l'utilisateur en est membre, ou s'il est
 * `super_admin` (audit AZ-06 : un `admin` global n'est plus dispensé
 * d'appartenance). Retourne `null` si l'org est introuvable/inactive ou si
 * l'accès n'est pas autorisé, et les appelants DOIVENT traiter `null` comme
 * « aucun accès » (fail-closed), jamais comme « accès global ».
 */
export async function getRequestOrgId(user: {
  id: string;
  globalRole: string;
}): Promise<string | null> {
  const h = await headers();
  const slug = h.get("x-org-slug");
  const org = await resolveRequestOrg(slug, {
    id: user.id,
    canCrossOrg: canCrossOrgBoundary(user.globalRole as UserRole),
  });
  return org?.orgId ?? null;
}
