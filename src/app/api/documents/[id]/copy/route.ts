import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  checkDocumentViewAccess,
  checkSpaceEditAccess,
} from "@/lib/auth/check-access";
import { isClassificationAllowed } from "@/lib/auth/classification";
import { readDocument, writeDocument } from "@/lib/storage/filesystem";
import { commitFile } from "@/lib/git/repository";
import slugify from "slugify";
import { logActivity } from "@/lib/activity";
import { z } from "zod";
import type { ClassificationLevel } from "@/types";

const copySchema = z.object({
  targetSpaceSlug: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const parsed = copySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Récupérer le document source
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: "Document introuvable" }, { status: 404 });

  // Copier un document, c'est en restituer le contenu dans un espace que l'on maitrise,
  // avec `createdBy` a son propre nom. Une simple permission d'espace non nulle laissait
  // un editeur aveugle sur un document `secret` s'en faire une copie lisible : le droit
  // de lecture sur le document lui-meme (classification comprise) est exige.
  const canViewSource = await checkDocumentViewAccess(user, doc.spaceId, doc.id);
  if (!canViewSource) {
    return NextResponse.json({ error: "Accès refusé (document source)" }, { status: 403 });
  }

  // Récupérer l'espace source pour lire le contenu
  const [sourceSpace] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, doc.spaceId))
    .limit(1);
  if (!sourceSpace) return NextResponse.json({ error: "Espace source introuvable" }, { status: 404 });

  // Récupérer l'espace cible
  const [targetSpace] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.slug, parsed.data.targetSpaceSlug))
    .limit(1);
  if (!targetSpace) return NextResponse.json({ error: "Espace cible introuvable" }, { status: 404 });

  // Vérifier la permission d'écriture sur l'espace cible
  const canEditTarget = await checkSpaceEditAccess(user, targetSpace.id);
  if (!canEditTarget) {
    return NextResponse.json({ error: "Accès refusé (espace cible)" }, { status: 403 });
  }

  // La copie herite de la classification de la source, et ne peut jamais descendre
  // sous le plancher de l'espace cible : copier n'est pas un moyen de declasser.
  const sourceClassification = (doc.classification || "internal") as ClassificationLevel;
  const targetSpaceClassification = (targetSpace.classification || "internal") as ClassificationLevel;
  const copyClassification = isClassificationAllowed(sourceClassification, targetSpaceClassification)
    ? sourceClassification
    : targetSpaceClassification;

  // Lire le contenu du document source
  let content = doc.contentText || "";
  if (!doc.isFolder) {
    try {
      content = await readDocument(sourceSpace.gitRepoPath, doc.filePath);
    } catch {
      content = doc.contentText || "";
    }
  }

  // Générer un titre, slug et filePath uniques pour la copie
  const copyTitle = `${doc.title} (copie)`;
  const baseSlug = slugify(copyTitle, { lower: true, strict: true });
  const timestamp = Date.now();
  const copySlug = `${baseSlug}-${timestamp}`;
  const filePath = doc.isFolder ? `${copySlug}/` : `${copySlug}.md`;

  // Écrire le fichier sur le filesystem de l'espace cible
  if (!doc.isFolder) {
    await writeDocument(targetSpace.gitRepoPath, filePath, content);
    await commitFile(
      targetSpace.gitRepoPath,
      filePath,
      `Copie : ${copyTitle}`,
      user.name,
      user.email
    );
  }

  // Insérer la copie en base de données
  const [copyDoc] = await db
    .insert(documents)
    .values({
      spaceId: targetSpace.id,
      parentId: null,
      title: copyTitle,
      slug: copySlug,
      filePath,
      visibility: doc.visibility,
      classification: copyClassification,
      isFolder: doc.isFolder,
      createdBy: user.id,
      contentText: doc.isFolder ? null : (content || null),
    })
    .returning();

  logActivity({
    userId: user.id,
    action: "copy",
    entityType: "document",
    entityId: copyDoc.id,
    metadata: {
      sourceDocumentId: id,
      sourceTitle: doc.title,
      targetSpaceSlug: targetSpace.slug,
    },
  });

  return NextResponse.json({
    ok: true,
    documentId: copyDoc.id,
    spaceSlug: targetSpace.slug,
  });
}
