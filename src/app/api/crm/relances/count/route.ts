import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { countRelances } from "@/lib/crm/relances";

const querySchema = z.object({ tz: z.string().max(64).optional() });

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const parsed = querySchema.safeParse({ tz: new URL(req.url).searchParams.get("tz") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", code: "invalid_params" }, { status: 400 });
  }

  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json({ count: await countRelances(ctx, { tz: parsed.data.tz }) });
}
