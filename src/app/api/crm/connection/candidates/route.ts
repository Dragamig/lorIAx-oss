import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { listCandidates } from "@/lib/crm/connection";
import { CRM_ROLES } from "@/lib/crm/fields";

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "admin", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const role = new URL(req.url).searchParams.get("role");
  const found = CRM_ROLES.find((r) => r === role);
  if (!found) {
    return NextResponse.json({ error: "Rôle invalide", code: "invalid_role" }, { status: 400 });
  }
  const candidates = await listCandidates(access.orgId, access.user.id, found);
  return NextResponse.json({ role: found, candidates });
}
