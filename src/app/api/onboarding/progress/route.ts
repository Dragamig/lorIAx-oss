// GET /api/onboarding/progress
// Renvoie la progression onboarding de l'utilisateur courant.

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getProgress } from "@/lib/onboarding/progress";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const progress = await getProgress(user.id);
  return NextResponse.json({ progress });
}
