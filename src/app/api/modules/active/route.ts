import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getActiveCapabilities } from "@/lib/modules/capabilities";
import { getRequestOrgId } from "@/lib/org/get-request-org";

/**
 * Capacités des modules actifs (modules + extensions éditeur + /commandes).
 * Consommé par l'éditeur pour charger conditionnellement extensions et slash.
 * Lecture réservée aux utilisateurs authentifiés (non sensible, non-admin).
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Les capacités sont bornées par le plan effectif de l'organisation courante :
  // une licence d'instance enterprise n'ouvre plus tous les modules à une org restée
  // en gratuit. Org non résolue = repli sur la seule licence (mono-tenant).
  const orgId = await getRequestOrgId(user);
  const caps = await getActiveCapabilities(orgId);
  return NextResponse.json(caps);
}
