import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { createFolder, listFolders } from "@/lib/media/folders";
import { folderErrorResponse, readJsonObject } from "@/lib/media/folders-http";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  try {
    const folders = await listFolders(user, orgId);
    return NextResponse.json({ folders }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return folderErrorResponse(e);
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
    const parentId = body.parentId === undefined || body.parentId === null ? null : body.parentId;
    if (parentId !== null && typeof parentId !== "string") {
      return NextResponse.json({ error: "Dossier parent invalide" }, { status: 400 });
    }
    const folder = await createFolder(user, orgId, { name: body.name, parentId });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (e) {
    return folderErrorResponse(e);
  }
}
