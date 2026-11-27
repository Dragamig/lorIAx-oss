import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { loadRelances } from "@/lib/crm/relances";

const flag = z.enum(["1", "true", "0", "false"]).optional().transform((v) => v === "1" || v === "true");
const querySchema = z.object({
  horizon: z.coerce.number().int().min(1).max(31).default(7),
  mine: flag,
  tz: z.string().max(64).optional(),
});

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const sp = new URL(req.url).searchParams;
  const parsed = querySchema.safeParse({
    horizon: sp.get("horizon") ?? undefined,
    mine: sp.get("mine") ?? undefined,
    tz: sp.get("tz") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", code: "invalid_params" }, { status: 400 });
  }

  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const { horizon, mine, tz } = parsed.data;
  return NextResponse.json(await loadRelances(ctx, { horizon, mine, tz }));
}
