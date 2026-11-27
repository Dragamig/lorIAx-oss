import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiModelAssignments, aiUsageTypeEnum } from "@/lib/db/schema-ai";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  canCrossOrgBoundary,
  hasGlobalRole,
  INSTANCE_ADMIN_ONLY_MESSAGE,
} from "@/lib/auth/rbac";
import type { UserRole } from "@/types";

/**
 * Assignation d'un modèle par usage (audit AZ-06, lot 6).
 *
 * `ai_model_assignments` n'a pas de colonne d'organisation et ne porte qu'une
 * ligne par usage : c'est une ressource de portée instance. Le corollaire de
 * l'ADR-079 s'y applique tel quel, il n'y a rien à filtrer dessus, donc son
 * ÉCRITURE se règle par le rôle, avec `INSTANCE_ADMIN_ONLY_MESSAGE` en 403.
 *
 * Laissée à `admin`, cette route donnait à tout administrateur d'organisation
 * un levier inter-tenants entier : désactiver l'assignation, ramener le délai
 * ou le nombre de tentatives à une valeur qui fait échouer tout le monde, ou
 * repointer l'usage vers un autre fournisseur. La capture d'inférence
 * proprement dite est bloquée en aval par la sélection cloisonnée du résolveur
 * de fournisseur, mais le déni de service, lui, restait ouvert.
 *
 * La LECTURE reste ouverte au rôle `admin`, exactement comme les fournisseurs
 * de portée instance restent lisibles dans `providers/scope.ts` : le contenu
 * est la configuration partagée de l'instance, jamais la donnée d'un tenant, et
 * la fermer viderait l'écran d'assignation de modèle de tout administrateur
 * d'organisation.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const assignments = await db.select().from(aiModelAssignments);

  return NextResponse.json(assignments);
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  // Ressource de portée instance : l'écriture se règle par le rôle.
  if (!canCrossOrgBoundary(user.globalRole as UserRole)) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({error: 'Invalid JSON'}, {status: 400});
  }
  const {
    usageType,
    providerId,
    model,
    fallbackProviderId,
    fallbackModel,
    timeoutSeconds,
    maxRetries,
    isEnabled,
  } = body;

  if (!usageType || !providerId || !model) {
    return NextResponse.json(
      { error: "usageType, providerId et model sont requis" },
      { status: 400 }
    );
  }

  // Check if assignment already exists for this usage type
  const [existing] = await db
    .select()
    .from(aiModelAssignments)
    .where(eq(aiModelAssignments.usageType, usageType))
    .limit(1);

  if (existing) {
    // Update
    await db
      .update(aiModelAssignments)
      .set({
        providerId,
        model,
        fallbackProviderId: fallbackProviderId || null,
        fallbackModel: fallbackModel || null,
        timeoutSeconds: timeoutSeconds ?? 30,
        maxRetries: maxRetries ?? 1,
        isEnabled: isEnabled ?? true,
        updatedAt: new Date(),
      })
      .where(eq(aiModelAssignments.id, existing.id));
  } else {
    // Insert
    await db.insert(aiModelAssignments).values({
      usageType,
      providerId,
      model,
      fallbackProviderId: fallbackProviderId || null,
      fallbackModel: fallbackModel || null,
      timeoutSeconds: timeoutSeconds ?? 30,
      maxRetries: maxRetries ?? 1,
      isEnabled: isEnabled ?? true,
    });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }
  if (!canCrossOrgBoundary(user.globalRole as UserRole)) {
    return NextResponse.json({ error: INSTANCE_ADMIN_ONLY_MESSAGE }, { status: 403 });
  }
  const usageType = request.nextUrl.searchParams.get("usageType");
  if (!usageType) {
    return NextResponse.json({ error: "usageType requis" }, { status: 400 });
  }
  const usages: readonly string[] = aiUsageTypeEnum.enumValues;
  if (!usages.includes(usageType)) {
    return NextResponse.json({ error: "usageType inconnu" }, { status: 400 });
  }
  await db.delete(aiModelAssignments).where(eq(aiModelAssignments.usageType, usageType as (typeof aiUsageTypeEnum.enumValues)[number]));
  return NextResponse.json({ success: true });
}
