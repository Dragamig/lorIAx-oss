import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiRequest, requireScope } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import { checkSpaceEditAccess } from "@/lib/auth/check-access";
import { isClassificationAllowed } from "@/lib/auth/classification";
import { logActivity } from "@/lib/activity";
import { writeDocument } from "@/lib/storage/filesystem";
import { commitFile } from "@/lib/git/repository";
import { z } from "zod";
import type { ClassificationLevel } from "@/types";
import slugify from "slugify";
import { randomUUID } from "crypto";

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

  // Check space exists
  const [space] = await db
    .select({ id: spaces.id, gitRepoPath: spaces.gitRepoPath, classification: spaces.classification })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) {
    return apiError("Espace introuvable", 404);
  }

  // `spaceId` vient du corps de la requete et n'etait controle par personne : toute cle
  // API `documents:write` pouvait deposer un document dans n'importe quel espace.
  // Le scope autorise l'appel, la permission d'espace autorise la cible.
  const canEdit = await checkSpaceEditAccess(auth.user, space.id);
  if (!canEdit) {
    return apiError("Accès refusé", 403);
  }

  // Meme plafond de classification qu'au PATCH : un espace `confidential` n'accepte pas
  // la creation d'un document `public`.
  const spaceClassification = (space.classification || "internal") as ClassificationLevel;
  if (classification && !isClassificationAllowed(classification, spaceClassification)) {
    return apiError(
      `Classification « ${classification} » non autorisée dans cet espace (niveau minimum : ${spaceClassification})`,
      400
    );
  }

  const slug = slugify(title, { lower: true, strict: true });
  const filePath = `${slug}.md`;
  const id = randomUUID();

  // Write markdown content if provided
  if (content) {
    await writeDocument(space.gitRepoPath, filePath, content);
    await commitFile(
      space.gitRepoPath,
      filePath,
      `Création : ${title}`,
      auth.user.name,
      auth.user.email
    );
  }

  const [created] = await db
    .insert(documents)
    .values({
      id,
      spaceId,
      parentId: parentId || null,
      title,
      slug,
      filePath,
      visibility: visibility || "team",
      classification: (classification || space.classification || "internal") as ClassificationLevel,
      isFolder: false,
      createdBy: auth.user.id,
      icon: icon || null,
      contentText: content || null,
    })
    .returning();

  logActivity({
    userId: auth.user.id,
    action: "create",
    entityType: "document",
    entityId: id,
    metadata: { title, source: "api" },
  });

  return apiSuccess(created, undefined, 201);
}
