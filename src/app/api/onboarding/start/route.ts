// POST /api/onboarding/start
// Initialise la progression d'onboarding et crée l'espace démo associé.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { initProgress } from "@/lib/onboarding/progress";
import { createDemoSpace } from "@/lib/onboarding/demo-space";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Cloisonnement multi-tenant : l'espace démo ne peut naître que dans une
  // organisation dont l'utilisateur est membre, sinon 404 (fail-closed).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  await initProgress(user.id);
  const space = await createDemoSpace(user.id, orgId);
  return NextResponse.json({
    ok: true,
    demoSpaceId: space.id,
    demoSpaceSlug: space.slug,
  });
}
