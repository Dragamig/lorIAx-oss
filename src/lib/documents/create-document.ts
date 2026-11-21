/**
 * Helper pur de création de document — extrait de `POST /api/v1/documents`
 * pour être réutilisable hors contexte HTTP (action de workflow
 * `create_document`, scripts, seed). La route reste l'unique point d'auth ; ce
 * helper suppose que l'appelant a déjà vérifié les droits sur l'espace.
 *
 * Effets : écrit le markdown + commit git (si `content`), insère la ligne
 * `documents`, journalise l'activité. Retourne la ligne créée.
 */
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { writeDocument } from "@/lib/storage/filesystem";
import { commitFile } from "@/lib/git/repository";
import { seedCollabState } from "@/lib/collab/seed-state";
import { logActivity } from "@/lib/activity";
import logger from "@/lib/logger";
import slugify from "slugify";
import { randomUUID } from "crypto";
import type { ClassificationLevel } from "@/types";

/** Levée quand l'espace cible n'existe pas. La route la traduit en 404. */
export class SpaceNotFoundError extends Error {
  constructor(public readonly spaceId: string) {
    super(`Espace introuvable : ${spaceId}`);
    this.name = "SpaceNotFoundError";
  }
}

export interface CreateDocumentInput {
  spaceId: string;
  title: string;
  content?: string;
  parentId?: string | null;
  visibility?: "private" | "team" | "public";
  classification?: ClassificationLevel;
  icon?: string | null;
  /** userId créateur (FK documents.created_by). */
  createdBy: string;
  /** Nom/email pour la signature du commit git. */
  authorName: string;
  authorEmail: string;
  /** Trace d'activité (`api` par défaut, `automation` pour un workflow). */
  activitySource?: string;
}

export async function createDocument(input: CreateDocumentInput) {
  const {
    spaceId,
    title,
    content,
    parentId,
    visibility,
    classification,
    icon,
    createdBy,
    authorName,
    authorEmail,
    activitySource = "api",
  } = input;

  const [space] = await db
    .select({
      id: spaces.id,
      gitRepoPath: spaces.gitRepoPath,
      classification: spaces.classification,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);

  if (!space) throw new SpaceNotFoundError(spaceId);

  if (!title || !title.trim()) throw new Error('Title required');

  const slug = slugify(title, { lower: true, strict: true });
  const filePath = `${slug}.md`;
  const id = randomUUID();

  if (parentId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parentId)) throw new Error('Invalid parentId UUID');

  // Écrit le markdown + commit git uniquement si un contenu est fourni.
  if (content) {
    await writeDocument(space.gitRepoPath, filePath, content);
    await commitFile(space.gitRepoPath, filePath, `Création : ${title}`, authorName, authorEmail);
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
      createdBy,
      icon: icon || null,
      contentText: content || null,
    })
    .returning();

  // Seed the collaborative state so the editor does not open an empty document.
  if (content) {
    try {
      await seedCollabState(created.id, content);
    } catch (err) {
      logger.error({ error: String(err), documentId: created.id }, "Failed to seed Yjs state");
    }
  }

  logActivity({
    userId: createdBy,
    action: "create",
    entityType: "document",
    entityId: id,
    metadata: { title, source: activitySource },
  });

  return created;
}
