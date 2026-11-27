import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { loadDossiers } from "@/lib/crm/dossiers";

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json(await loadDossiers(ctx));
}
