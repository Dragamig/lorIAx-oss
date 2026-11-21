import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { loadConnection } from "@/lib/crm/connection";

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: false }, req);
  if (!access.ok) return access.response;
  let complete = false;
  if (access.enabled) {
    const conn = await loadConnection(access.orgId, access.user.id, "viewer");
    complete = !!conn && conn.complete;
  }
  return NextResponse.json({ enabled: access.enabled, complete, canAdmin: access.isAdmin });
}
