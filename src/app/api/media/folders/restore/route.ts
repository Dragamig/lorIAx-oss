import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { restoreFolder } from "@/lib/media/folders";
import { folderErrorResponse, readJsonObject } from "@/lib/media/folders-http";

/** POST { undo } : inverse de DELETE /api/media/folders/[id]. */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  try {
    const result = await restoreFolder(user, orgId, body.undo);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return folderErrorResponse(e);
  }
}
