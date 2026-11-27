import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { loadDeal } from "@/lib/crm/deals";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ rowId: string }> }) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const { rowId } = await params;
  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return notFound();

  // rowId non uuid, d'une autre base ou d'une autre organisation : même 404 que l'inexistant.
  const deal = await loadDeal(ctx, rowId);
  return deal ? NextResponse.json(deal) : notFound();
}
