import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { studioImageScope, toStudioImage } from "@/lib/media/studio-image";
import { eq, and, isNull } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";

/**
 * Image unitaire de la bibliothèque d'images de l'admin (renommage,
 * suppression). Voir `../route.ts` pour le constat d'audit complet
 * (audit du 2026-08-19) : `requireOrgScoped` s'ajoute ici au rôle global
 * d'administrateur déjà exigé, il ne le remplace pas.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const { id } = await params;
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Nom requis" }, { status: 400 });

  const [row] = await db
    .update(media)
    .set({ filename: name.trim().slice(0, 255), updatedAt: new Date() })
    .where(and(eq(media.id, id), studioImageScope(orgId), isNull(media.spaceId)))
    .returning();

  if (!row) return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
  return NextResponse.json(toStudioImage(row));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const { id } = await params;

  const [row] = await db
    .update(media)
    .set({ deletedAt: new Date(), deletedBy: user.id })
    .where(and(eq(media.id, id), studioImageScope(orgId), isNull(media.spaceId)))
    .returning();

  if (!row) return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
  // Suppression douce : l'objet S3 reste en place (purge de corbeille en 1b).
  return new NextResponse(null, { status: 204 });
}
