import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getLibraryStats } from "@/lib/media/list";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const stats = await getLibraryStats(user, orgId);
  return NextResponse.json(stats, { headers: { "Cache-Control": "private, no-store" } });
}
