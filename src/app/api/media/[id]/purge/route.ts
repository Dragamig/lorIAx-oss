import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { PurgeError, eraseMediaForever } from "@/lib/media/purge";
import { UUID_RE } from "@/lib/media/folders-http";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  }
  try {
    await eraseMediaForever(user, orgId, id);
  } catch (e) {
    if (e instanceof PurgeError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
