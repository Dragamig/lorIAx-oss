// POST /api/onboarding/step
// Marque l'étape courante du tour (1..TOUR_STEP_COUNT).

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { markTourStep } from "@/lib/onboarding/progress";
import { TOUR_STEP_COUNT } from "@/lib/onboarding/types";

const schema = z.object({
  step: z.number().int().min(1).max(TOUR_STEP_COUNT),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  await markTourStep(user.id, parsed.data.step);
  return NextResponse.json({ ok: true });
}
