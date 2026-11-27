import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { UUID_RE, readJsonObject } from "@/lib/media/folders-http";
import { deleteSavedView, updateSavedView } from "@/lib/media/saved-views";
import { savedViewErrorResponse } from "@/lib/media/saved-views-http";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name?, shared?, query? } */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Vue introuvable" }, { status: 404 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  try {
    const view = await updateSavedView(user, orgId, id, {
      name: body.name,
      shared: body.shared,
      query: body.query,
    });
    return NextResponse.json({ view });
  } catch (e) {
    return savedViewErrorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Vue introuvable" }, { status: 404 });
  try {
    await deleteSavedView(user, orgId, id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return savedViewErrorResponse(e);
  }
}
