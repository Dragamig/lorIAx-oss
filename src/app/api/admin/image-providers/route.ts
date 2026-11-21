import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageProviders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { encrypt } from "@/lib/crypto";
import { getRequestOrgId } from "@/lib/org/get-request-org";

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Cloisonnement multi-tenant : le rôle `admin` vaut dans SON organisation et
  // ne dispense pas d'y appartenir (audit AZ-06). `null` = aucun accès, 404.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  const providers = await db
    .select({
      id: imageProviders.id,
      name: imageProviders.name,
      displayName: imageProviders.displayName,
      providerType: imageProviders.providerType,
      isEnabled: imageProviders.isEnabled,
      hasApiKey: imageProviders.apiKeyEnc,
      createdAt: imageProviders.createdAt,
    })
    .from(imageProviders)
    .where(eq(imageProviders.organizationId, orgId));

  return NextResponse.json(
    providers.map((p) => ({ ...p, hasApiKey: !!p.hasApiKey }))
  );
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Cloisonnement multi-tenant : le rôle `admin` vaut dans SON organisation et
  // ne dispense pas d'y appartenir (audit AZ-06). `null` = aucun accès, 404.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }

  let body;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }
  const { name, displayName, providerType, baseUrl, apiKey } = body;
  if (!name || !displayName || !providerType)
    return NextResponse.json({ error: "name, displayName et providerType requis" }, { status: 400 });

  const [row] = await db
    .insert(imageProviders)
    .values({
      name,
      displayName,
      providerType,
      baseUrl: baseUrl || null,
      apiKeyEnc: apiKey ? encrypt(apiKey) : null,
      isEnabled: false,
      organizationId: orgId,
    })
    .returning({
      id: imageProviders.id,
      name: imageProviders.name,
      displayName: imageProviders.displayName,
      providerType: imageProviders.providerType,
      isEnabled: imageProviders.isEnabled,
    });

  return NextResponse.json(row, { status: 201 });
}
