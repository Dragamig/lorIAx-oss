import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageProviders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { encrypt } from "@/lib/crypto";
import { getRequestOrgId } from "@/lib/org/get-request-org";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Cloisonnement multi-tenant : appartenance obligatoire à l'organisation du
  // sous-domaine, même pour un `admin` global (audit AZ-06).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.isEnabled === "boolean") updates.isEnabled = body.isEnabled;
  if (typeof body.apiKey === "string" && body.apiKey) updates.apiKeyEnc = encrypt(body.apiKey);
  if (typeof body.displayName === "string" && body.displayName) updates.displayName = body.displayName;

  const [row] = await db
    .update(imageProviders)
    .set(updates)
    .where(and(eq(imageProviders.id, id), eq(imageProviders.organizationId, orgId)))
    .returning({
      id: imageProviders.id,
      name: imageProviders.name,
      isEnabled: imageProviders.isEnabled,
    });

  if (!row) return NextResponse.json({ error: "Provider introuvable" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Cloisonnement multi-tenant : appartenance obligatoire à l'organisation du
  // sous-domaine, même pour un `admin` global (audit AZ-06).
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const { id } = await params;

  await db
    .delete(imageProviders)
    .where(and(eq(imageProviders.id, id), eq(imageProviders.organizationId, orgId)));

  return new NextResponse(null, { status: 204 });
}
