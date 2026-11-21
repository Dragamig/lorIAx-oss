import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import type { SessionUser } from "@/types";
import { deleteFolder, moveFolder, renameFolder, updateFolder } from "@/lib/media/folders";
import { UUID_RE, folderErrorResponse, readJsonObject } from "@/lib/media/folders-http";

type Ctx = { params: Promise<{ id: string }> };

type Resolved =
  | { res: NextResponse }
  | { res?: undefined; user: SessionUser; orgId: string; id: string };

async function context(ctx: Ctx): Promise<Resolved> {
  const user = await getSessionUser();
  if (!user) return { res: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
  const orgId = await getRequestOrgId(user);
  if (!orgId) return { res: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return { res: NextResponse.json({ error: "Dossier introuvable" }, { status: 404 }) };
  return { user, orgId, id };
}

/** PATCH { name?, parentId? } : renomme et/ou déplace (`parentId: null` = racine). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const c = await context(ctx);
  if (c.res) return c.res;
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  const hasName = "name" in body;
  const hasParent = "parentId" in body;
  if (!hasName && !hasParent) {
    return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
  }
  if (hasParent && body.parentId !== null && typeof body.parentId !== "string") {
    return NextResponse.json({ error: "Dossier parent invalide" }, { status: 400 });
  }
  try {
    let folder: { id: string; parentId: string | null; name: string } | undefined;
    if (hasParent && hasName) {
      folder = await updateFolder(c.user, c.orgId, c.id, {
        name: body.name,
        parentId: body.parentId as string | null,
      });
    } else if (hasParent) folder = await moveFolder(c.user, c.orgId, c.id, body.parentId as string | null);
    else folder = await renameFolder(c.user, c.orgId, c.id, body.name);
    return NextResponse.json({ folder });
  } catch (e) {
    return folderErrorResponse(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const c = await context(ctx);
  if (c.res) return c.res;
  try {
    const result = await deleteFolder(c.user, c.orgId, c.id);
    return NextResponse.json(result);
  } catch (e) {
    return folderErrorResponse(e);
  }
}
