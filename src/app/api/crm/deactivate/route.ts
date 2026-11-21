import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { deactivateCrm } from "@/lib/crm/activation";

export async function POST(req: NextRequest) {
  const access = await requireCrm({ level: "admin", requireEnabled: false }, req);
  if (!access.ok) return access.response;
  await deactivateCrm(access.orgId, access.user.id);
  return NextResponse.json({ enabled: false });
}
