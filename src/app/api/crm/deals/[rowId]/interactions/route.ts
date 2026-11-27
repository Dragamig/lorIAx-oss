import { rowContextFromRequest } from "@/lib/databases/row-request-context";
import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { listDealInteractions } from "@/lib/crm/deals";
import { createInteraction } from "@/lib/crm/interaction-write";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ rowId: string }> }) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const { rowId } = await params;
  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return notFound();

  const interactions = await listDealInteractions(ctx, rowId);
  return interactions ? NextResponse.json({ interactions }) : notFound();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ rowId: string }> }) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const { rowId } = await params;
  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return notFound();

  const raw = await req.json().catch(() => null);
  const tz = new URL(req.url).searchParams.get("tz") ?? undefined;
  const result = await createInteraction(ctx, rowId, raw, {
    tz: tz && tz.length <= 64 ? tz : undefined,
    rowCtx: rowContextFromRequest(req, access.user),
  });
  if (result.status === "not_found") return notFound();
  if (result.status === "invalid_params") {
    return NextResponse.json({ error: "Paramètres invalides", code: "invalid_params" }, { status: 400 });
  }
  if (result.status === "error") return NextResponse.json({ error: "Paramètres invalides", code: result.code }, { status: 400 });
  return NextResponse.json({ interaction: result.interaction }, { status: 201 });
}
