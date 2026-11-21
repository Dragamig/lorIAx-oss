// DELETE /api/onboarding/demo-space
// Supprime l'espace démo « Découverte LorIAx » de l'utilisateur courant.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { deleteDemoSpace } from "@/lib/onboarding/demo-space";

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Cloisonnement multi-tenant : l'organisation visée doit être celle dont
  // l'utilisateur est membre, sinon 404 (fail-closed).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const deleted = await deleteDemoSpace(user.id, orgId);
  return NextResponse.json({ ok: deleted });
}
