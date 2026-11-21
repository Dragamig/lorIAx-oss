import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  canCrossOrgBoundary,
  hasGlobalRole,
  INSTANCE_ADMIN_ONLY_MESSAGE,
} from "@/lib/auth/rbac";
import { encrypt } from "@/lib/crypto";
import { externalUrlSchema } from "@/lib/security/url-schema";
import type { UserRole } from "@/types";
import {
  defaultScopeFilter,
  requireRequestOrg,
  resolveProviderScope,
  visibleProvidersFilter,
} from "./scope";

/**
 * Contrôle de forme de l'adresse de base d'un fournisseur (ADR-078).
 *
 * `apiBaseUrl` était accepté tel quel, puis dormait en base jusqu'à ce qu'un
 * consommateur l'appelle : la détection de modèles par identifiant de
 * fournisseur, restée au rôle `admin`, suffisait alors à faire émettre une
 * requête sortante vers la cible choisie et à en relayer le résultat. Réserver
 * les routes qui prennent une URL dans le CORPS à `super_admin` ne fermait donc
 * que la moitié du chemin : le contournement se faisait en deux temps, création
 * puis détection.
 *
 * On ne refuse PAS les adresses privées : pointer un Ollama du réseau local est
 * l'usage normal de LorIAx auto-hébergé, et le lot 2 a explicitement conservé
 * les cibles internes pour les routes d'administration d'IA. Ce qui est refusé
 * ici, c'est tout ce qui n'est pas une adresse http(s) analysable, et c'est
 * `detect-models` qui ferme le canal de retour à l'émission.
 */
const providerBaseUrlSchema = externalUrlSchema(2048, {
  allowPrivateTargets: true,
});

/** `null` si l'adresse est acceptable, sinon la réponse de refus. */
function rejectInvalidBaseUrl(apiBaseUrl: unknown): NextResponse | null {
  if (apiBaseUrl === undefined || apiBaseUrl === null || apiBaseUrl === "") {
    return null;
  }
  const parsed = providerBaseUrlSchema.safeParse(apiBaseUrl);
  if (parsed.success) return null;
  return NextResponse.json(
    { error: "URL de base invalide : seules les adresses http ou https sont acceptées" },
    { status: 400 }
  );
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const org = await requireRequestOrg(user);
  if (!org.ok) return org.response;

  const providers = await db
    .select({
      id: aiProviders.id,
      name: aiProviders.name,
      displayName: aiProviders.displayName,
      connectorType: aiProviders.connectorType,
      apiBaseUrl: aiProviders.apiBaseUrl,
      defaultModel: aiProviders.defaultModel,
      isEnabled: aiProviders.isEnabled,
      isDefault: aiProviders.isDefault,
      pricing: aiProviders.pricing,
      icon: aiProviders.icon,
      color: aiProviders.color,
      config: aiProviders.config,
      organizationId: aiProviders.organizationId,
      createdAt: aiProviders.createdAt,
    })
    .from(aiProviders)
    .where(visibleProvidersFilter(org.orgId))
    .orderBy(aiProviders.displayName);

  return NextResponse.json(providers);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const org = await requireRequestOrg(user);
  if (!org.ok) return org.response;

  const body = await request.json();
  const {
    name,
    displayName,
    connectorType,
    apiBaseUrl,
    apiKeyEnc,
    defaultModel,
    pricing,
    icon,
    color,
    config,
    scope,
  } = body;

  if (!name || !displayName) {
    return NextResponse.json(
      { error: "Nom et nom d'affichage requis" },
      { status: 400 }
    );
  }

  const urlRefus = rejectInvalidBaseUrl(apiBaseUrl);
  if (urlRefus) return urlRefus;

  /**
   * Portée instance à la création (`scope: "instance"`).
   *
   * Le cloisonnement estampillait systématiquement l'organisation de la
   * requête, si bien que plus aucun verbe ne permettait de créer une ligne
   * `organization_id IS NULL`, alors que le module de portée et le résolveur
   * de fournisseur bâtissent toute leur logique sur l'existence de telles
   * lignes : une instance neuve devenait impossible à doter d'un fournisseur
   * partagé. Conformément au corollaire de l'ADR-079, la portée instance se
   * règle par le rôle, et jamais par défaut : il faut la demander
   * explicitement, et être administrateur d'instance.
   */
  let organizationId: string | null = org.orgId;
  if (scope === "instance") {
    if (!canCrossOrgBoundary(user.globalRole as UserRole)) {
      return NextResponse.json(
        { error: INSTANCE_ADMIN_ONLY_MESSAGE },
        { status: 403 }
      );
    }
    organizationId = null;
  }

  const [provider] = await db
    .insert(aiProviders)
    .values({
      name,
      displayName,
      connectorType: connectorType || "openai_compatible",
      apiBaseUrl: apiBaseUrl || null,
      apiKeyEnc: apiKeyEnc ? encrypt(apiKeyEnc) : null,
      defaultModel: defaultModel || null,
      pricing: pricing || null,
      icon: icon || null,
      color: color || null,
      config: config || {},
      // Le tenant du fournisseur vient de la requête, jamais du corps.
      organizationId,
    })
    .returning();

  return NextResponse.json(provider, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await request.json();
  const { id, organizationId: _ignoredOrgId, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "ID requis" }, { status: 400 });
  }

  // Contrôle de forme AVANT la résolution de portée : une adresse refusée ne
  // doit jamais être stockée, quel que soit le fournisseur visé.
  const urlRefus = rejectInvalidBaseUrl(updates.apiBaseUrl);
  if (urlRefus) return urlRefus;

  const scope = await resolveProviderScope(user, id, true);
  if (!scope.ok) return scope.response;

  // Chiffrer la clé API si fournie
  if (updates.apiKeyEnc) {
    updates.apiKeyEnc = encrypt(updates.apiKeyEnc);
  }

  // Si on active "isDefault", désactiver les autres de la même portée.
  if (updates.isDefault) {
    await db
      .update(aiProviders)
      .set({ isDefault: false })
      .where(defaultScopeFilter(scope.provider.organizationId));
  }

  await db.update(aiProviders).set(updates).where(eq(aiProviders.id, id));

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await request.json();
  if (!id) {
    return NextResponse.json({ error: "ID requis" }, { status: 400 });
  }

  const scope = await resolveProviderScope(user, id, true);
  if (!scope.ok) return scope.response;

  await db.delete(aiProviders).where(eq(aiProviders.id, id));

  return NextResponse.json({ success: true });
}
