import { NextResponse } from "next/server";
import { guardModuleEnabled } from "@/lib/modules/guard";
import { isModuleActive } from "@/lib/modules/enablement";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import type { SessionUser } from "@/types";

/**
 * Refuse les routes de présentations quand le module est coupé pour
 * l'organisation courante. Rend une réponse à retourner telle quelle, ou null.
 *
 * Un module coupé est transparent, pas interdit : la réponse est un 404, jamais
 * un 403, pour ne pas révéler l'existence d'une fonctionnalité qu'une
 * organisation n'a pas.
 */
export async function guardPresentationsModule(
  user: SessionUser
): Promise<NextResponse | null> {
  const orgId = await getRequestOrgId(user);
  return guardModuleEnabled("presentations", orgId);
}

/**
 * Même question, posée depuis une page : le rendu appelle `notFound()` sur un
 * faux, il n'a pas de réponse HTTP à propager.
 */
export async function isPresentationsModuleActive(
  user: SessionUser
): Promise<boolean> {
  const orgId = await getRequestOrgId(user);
  return isModuleActive("presentations", orgId);
}
