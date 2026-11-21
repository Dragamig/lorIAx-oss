import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiRequest, requireScope } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import { checkSpaceWriteAccess } from "@/lib/auth/check-access";
import { isClassificationAllowed } from "@/lib/auth/classification";
import type { ClassificationLevel } from "@/types";
import { createDocument, SpaceNotFoundError } from "@/lib/documents/create-document";
import { z } from "zod";

const createSchema = z.object({
  spaceId: z.string().uuid(),
  title: z.string().min(1).max(500),
  content: z.string().optional(),
  parentId: z.string().uuid().optional(),
  visibility: z.enum(["private", "team", "public"]).optional(),
  classification: z.enum(["public", "internal", "confidential", "secret"]).optional(),
  icon: z.string().max(50).optional(),
});

/**
 * POST /api/v1/documents — Create a document.
 */
export async function POST(request: Request) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "documents:write");
  if (scopeErr) return scopeErr;

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Données invalides", 400);
  }

  const { spaceId, title, content, parentId, visibility, classification, icon } = parsed.data;

  // L'espace cible doit appartenir à l'organisation de la clé API
  // (anti-fuite cross-tenant : pas d'injection de document dans l'espace d'un autre tenant).
  const [space] = await db
    .select({ id: spaces.id, classification: spaces.classification })
    .from(spaces)
    .where(and(eq(spaces.id, spaceId), eq(spaces.organizationId, auth.user.orgId)))
    .limit(1);
  if (!space) return apiError("Espace introuvable", 404);

  // Droit d'objet en écriture (audit du 2026-08-19, constat AZ-14). La route
  // s'arrêtait au cloisonnement d'organisation : une clé `documents:write`
  // fabriquée par n'importe quel compte du tenant créait un document dans
  // n'importe quel espace, y compris un espace dont le porteur ignore tout.
  // `checkSpaceWriteAccess` refuse le niveau `viewer`, la lecture ne suffit
  // donc pas à écrire. Même composition qu'en lecture : l'espace est déjà
  // borné à `auth.user.orgId`, le helper ne peut que restreindre davantage.
  const canWrite = await checkSpaceWriteAccess(auth.user, spaceId);
  if (!canWrite) return apiError("Accès refusé", 403);

  // Plafond de classification : un espace `confidential` n'accepte pas un document `public`.
  const floor = (space.classification || "internal") as ClassificationLevel;
  if (classification && !isClassificationAllowed(classification, floor)) {
    return apiError(
      `Classification « ${classification} » non autorisée dans cet espace (niveau minimum : ${floor})`,
      400
    );
  }

  // Le parent doit vivre dans l'espace visé. Sans ce contrôle, `parentId`
  // rattachait un document sous un parent d'un AUTRE espace : arborescence
  // incohérente, et le titre du document greffé apparaît dans un espace où son
  // auteur n'a rien à faire (même classe que le constat AZ-31 côté session).
  if (parentId) {
    const [parent] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, parentId), eq(documents.spaceId, spaceId)))
      .limit(1);
    if (!parent) return apiError("Document parent introuvable", 404);
  }

  try {
    const created = await createDocument({
      spaceId,
      title,
      content,
      parentId: parentId ?? null,
      visibility,
      classification,
      icon: icon ?? null,
      createdBy: auth.user.id,
      authorName: auth.user.name,
      authorEmail: auth.user.email,
      activitySource: "api",
    });
    return apiSuccess(created, undefined, 201);
  } catch (e) {
    if (e instanceof SpaceNotFoundError) return apiError("Espace introuvable", 404);
    throw e;
  }
}
