import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { loadPipeline } from "@/lib/crm/pipeline";

const flag = z.enum(["1", "true", "0", "false"]).optional().transform((v) => v === "1" || v === "true");
const querySchema = z.object({
  mine: flag,
  late: flag,
  ownerId: z.string().uuid().optional(),
  tz: z.string().max(64).optional(),
});

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const sp = new URL(req.url).searchParams;
  const parsed = querySchema.safeParse({
    mine: sp.get("mine") ?? undefined,
    late: sp.get("late") ?? undefined,
    ownerId: sp.get("ownerId") ?? undefined,
    tz: sp.get("tz") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", code: "invalid_params" }, { status: 400 });
  }

  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const { mine, late, ownerId, tz } = parsed.data;
  return NextResponse.json(await loadPipeline(ctx, { mine, late, ownerId: ownerId ?? null, tz }));
}
