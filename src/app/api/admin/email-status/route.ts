import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { canCrossOrgBoundary } from "@/lib/auth/rbac";
import { isEmailConfigured } from "@/lib/email/email-configured";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !canCrossOrgBoundary(user.globalRole)) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  return NextResponse.json({ configured: await isEmailConfigured() });
}
