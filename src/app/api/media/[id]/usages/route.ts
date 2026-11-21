import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { UUID_RE } from "@/lib/media/folders-http";
import { getMediaUsages } from "@/lib/media/usage-links";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  }
  const result = await getMediaUsages(user, orgId, id);
  if (!result) return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
