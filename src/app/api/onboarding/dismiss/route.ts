// POST /api/onboarding/dismiss
// Marque le tour comme abandonné (l'utilisateur peut toujours le relancer via le menu Aide).

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { dismissTour } from "@/lib/onboarding/progress";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await dismissTour(user.id);
  return NextResponse.json({ ok: true });
}
