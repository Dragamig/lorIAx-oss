import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { labels } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getSpaceBySlugForRequest } from "@/lib/org/scoped-space";
import { canAdminSpace } from "@/lib/auth/rbac";
import { getSpacePermission } from "@/lib/auth/check-access";
import { z } from "zod";

const createSpaceLabelSchema = z.object({
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format attendu : #RRGGBB)"),
});

// GET /api/spaces/[slug]/labels — labels globaux + labels de l'espace (fusionnés)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { slug } = await params;
  const space = await getSpaceBySlugForRequest(slug, user);
  if (!space) return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });

  const result = await db
    .select()
    .from(labels)
    .where(
      or(
        eq(labels.isGlobal, true),
        eq(labels.spaceId, space.id)
      )
    )
    .orderBy(labels.name);

  return NextResponse.json(result);
}

// POST /api/spaces/[slug]/labels — créer un label dans l'espace
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { slug } = await params;
  const space = await getSpaceBySlugForRequest(slug, user);
  if (!space) return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });

  // Calcul unifié des permissions d'espace (`getSpacePermission`). La fonction
  // locale qui vivait ici ne lisait que les lignes `space_permissions` portant
  // un `user_id` : elle ignorait le propriétaire de l'espace, les lignes
  // accordées à une équipe et les espaces possédés par une équipe. Le
  // propriétaire d'un espace ne pouvait donc pas gérer les étiquettes du sien,
  // et les responsables d'équipe n'y avaient pas droit non plus sur les espaces
  // de leur équipe. Le rebranchement corrige ces deux cas.
  const spacePermission = await getSpacePermission(user.id, space.id);
  if (!canAdminSpace(user.globalRole, spacePermission)) {
    return NextResponse.json({ error: "Droits insuffisants pour gérer les labels de cet espace" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createSpaceLabelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [label] = await db
    .insert(labels)
    .values({
      name: parsed.data.name,
      color: parsed.data.color,
      spaceId: space.id,
      isGlobal: false,
      createdBy: user.id,
    })
    .returning();

  return NextResponse.json(label, { status: 201 });
}
