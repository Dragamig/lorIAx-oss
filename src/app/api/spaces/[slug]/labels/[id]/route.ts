import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { labels } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getSpaceBySlugForRequest } from "@/lib/org/scoped-space";
import { canAdminSpace } from "@/lib/auth/rbac";
import { getSpacePermission } from "@/lib/auth/check-access";

// DELETE /api/spaces/[slug]/labels/[id] — supprimer un label d'espace
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { slug, id } = await params;
  const space = await getSpaceBySlugForRequest(slug, user);
  if (!space) return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });

  // Calcul unifié des permissions d'espace (cf. la route POST voisine) : la
  // fonction locale remplacée ignorait le propriétaire de l'espace et les
  // lignes accordées à une équipe.
  const spacePermission = await getSpacePermission(user.id, space.id);
  if (!canAdminSpace(user.globalRole, spacePermission)) {
    return NextResponse.json({ error: "Droits insuffisants pour gérer les labels de cet espace" }, { status: 403 });
  }

  // Sécurité : vérifier que le label appartient bien à cet espace (pas un label global)
  const [deleted] = await db
    .delete(labels)
    .where(
      and(
        eq(labels.id, id),
        eq(labels.spaceId, space.id),
        eq(labels.isGlobal, false)
      )
    )
    .returning();

  if (!deleted) {
    return NextResponse.json({ error: "Label introuvable dans cet espace" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
