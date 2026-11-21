import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTallyManager, tallyErrorResponse } from "@/lib/integrations/tally/access";
import { createTallyClient } from "@/lib/integrations/tally/client";
import {
  deleteTallyKey,
  getTallyConnectionStatus,
  normalizeTallyKey,
  saveTallyKey,
} from "@/lib/integrations/tally/key-store";
import { checkRateLimitAsync } from "@/lib/rate-limit";

const bodySchema = z.object({ apiKey: z.string().min(1).max(300) });

/** État de la connexion : jamais la clé, seulement un suffixe masqué. */
export async function GET() {
  const g = await requireTallyManager();
  if ("response" in g) return g.response;
  return NextResponse.json(await getTallyConnectionStatus(g.ctx.orgId));
}

/** Connecte ou remplace la clé, après un test de validité auprès de Tally. */
export async function PUT(request: Request) {
  const g = await requireTallyManager();
  if ("response" in g) return g.response;
  const limit = await checkRateLimitAsync(`tally-connect:${g.ctx.user.id}`, { maxRequests: 10, windowMs: 60_000 });
  if (!limit.success) return NextResponse.json({ error: "Trop de tentatives" }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const key = parsed.success ? normalizeTallyKey(parsed.data.apiKey) : null;
  if (!key) {
    return NextResponse.json({ error: "Clé invalide : elle commence par « tly- »", code: "invalid_format" }, { status: 400 });
  }
  try {
    await createTallyClient({ apiKey: key }).verify();
  } catch (e) {
    return tallyErrorResponse(e);
  }
  await saveTallyKey(g.ctx.orgId, g.ctx.user.id, key);
  return NextResponse.json(await getTallyConnectionStatus(g.ctx.orgId));
}

export async function DELETE() {
  const g = await requireTallyManager();
  if ("response" in g) return g.response;
  await deleteTallyKey(g.ctx.orgId);
  return NextResponse.json({ connected: false, maskedKey: null });
}
