import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { readJsonObject } from "@/lib/media/folders-http";
import { createSavedView, listSavedViews } from "@/lib/media/saved-views";
import { savedViewErrorResponse } from "@/lib/media/saved-views-http";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  try {
    const views = await listSavedViews(user, orgId);
    return NextResponse.json(views, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return savedViewErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  try {
    const view = await createSavedView(user, orgId, {
      name: body.name,
      query: body.query,
      shared: body.shared,
    });
    return NextResponse.json({ view }, { status: 201 });
  } catch (e) {
    return savedViewErrorResponse(e);
  }
}
