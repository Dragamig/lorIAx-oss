// POST /api/onboarding/event
// Enregistre un événement d'onboarding déclenché côté client (usage d'une
// fonctionnalité purement front, comme la palette de commandes).
// Les kinds acceptés sont restreints à CLIENT_EVENT_KINDS : les autres badges
// sont posés côté serveur au moment de l'action réelle.

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { recordOnboardingEvent } from "@/lib/onboarding/progress";
import { CLIENT_EVENT_KINDS } from "@/lib/onboarding/types";

const schema = z.object({
  kind: z.enum(CLIENT_EVENT_KINDS),
});

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  // recordOnboardingEvent est idempotent : seule la 1re occurrence compte.
  await recordOnboardingEvent(user.id, parsed.data.kind);
  return NextResponse.json({ ok: true });
}
