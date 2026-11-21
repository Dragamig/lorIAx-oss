import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, spaces, documentLinks, documentCollabStates } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

/** Supprime récursivement tous les descendants d'un document (dossiers inclus). */
async function deleteDocumentTree(docId: string): Promise<void> {
  const children = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.parentId, docId));
  for (const child of children) {
    await deleteDocumentTree(child.id);
  }
  await db.delete(documents).where(eq(documents.id, docId));
}
import { getSessionUser } from "@/lib/auth/get-user";
import {
  checkDocumentViewAccess,
  checkDocumentEditAccess,
  checkDocumentDeclassifyAccess,
} from "@/lib/auth/check-access";
import { documentMetadataColumns } from "@/lib/db/projections";
import { readDocument, writeDocument } from "@/lib/storage/filesystem";
import { commitFile } from "@/lib/git/repository";
import { rewriteDocumentRefs } from "@/lib/media/rewrite-document-refs";
import { createOrgKeyLookup } from "@/lib/media/attachment-key-lookup";
import { parseWikiLinks } from "@/lib/graph/links";
import { indexDocument } from "@/lib/ai/embeddings";
import { logActivity } from "@/lib/activity";
import { createNotifications } from "@/lib/notifications";
import { isClassificationAllowed, isDeclassification } from "@/lib/auth/classification";
import type { ClassificationLevel } from "@/types";
import { z } from "zod";
import logger from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  if (!doc) return NextResponse.json({ error: "Document non trouve" }, { status: 404 });

  // Vérifier les permissions de lecture
  const canView = await checkDocumentViewAccess(user, doc.spaceId, doc.id);
  if (!canView) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // PERF-09 — Paralléliser space + backlinks + contenu filesystem
  const [spaceResult, backlinks] = await Promise.all([
    db.select().from(spaces).where(eq(spaces.id, doc.spaceId)).limit(1),
    db
      .select({
        sourceId: documentLinks.sourceId,
        linkText: documentLinks.linkText,
        title: documents.title,
        slug: documents.slug,
      })
      .from(documentLinks)
      .innerJoin(documents, eq(documentLinks.sourceId, documents.id))
      .where(eq(documentLinks.targetId, id)),
  ]);
  const space = spaceResult[0];

  let content = "";
  if (space && !doc.isFolder) {
    try {
      content = await readDocument(space.gitRepoPath, doc.filePath);
    } catch {
      content = doc.contentText || "";
    }
  }

  const spaceClassification = space?.classification || "internal";

  // PERF-08 — Cache-Control pour éviter les re-fetch inutiles
  return NextResponse.json(
    { ...doc, content, backlinks, spaceClassification },
    {
      headers: {
        "Cache-Control": "private, max-age=0, stale-while-revalidate=30",
      },
    }
  );
}

const updateDocSchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().optional(),
  visibility: z.enum(["private", "team", "public"]).optional(),
  classification: z.enum(["public", "internal", "confidential", "secret"]).optional(),
  icon: z.string().max(50).nullable().optional(),
  properties: z.record(z.string(), z.unknown()).nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  if (!doc) return NextResponse.json({ error: "Document non trouve" }, { status: 404 });

  // Vérifier les permissions d'édition
  const canEdit = await checkDocumentEditAccess(user, doc.spaceId, doc.id);
  if (!canEdit) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const parsed = updateDocSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { title, visibility, classification, icon, properties } = parsed.data;
  let content = parsed.data.content;

  // Changer la classification exige le droit de lecture (écrire n'est pas lire), et
  // l'abaisser est réservé à l'auteur, aux admins d'espace et aux admins globaux :
  // sinon un éditeur déclasse un document secret puis le relit.
  if (classification && classification !== doc.classification) {
    const canView = await checkDocumentViewAccess(user, doc.spaceId, doc.id);
    if (!canView) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    if (isDeclassification(doc.classification as ClassificationLevel, classification)) {
      const canDeclassify = await checkDocumentDeclassifyAccess(user, doc.spaceId, doc.id);
      if (!canDeclassify) {
        return NextResponse.json(
          { error: "Seuls l'auteur et les administrateurs peuvent abaisser la classification" },
          { status: 403 }
        );
      }
    }
  }

  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, doc.spaceId))
    .limit(1);

  // Valider le plafond de classification espace → document
  if (classification && space) {
    const spaceClassification = (space.classification || "internal") as ClassificationLevel;
    if (!isClassificationAllowed(classification, spaceClassification)) {
      return NextResponse.json(
        { error: `Classification « ${classification} » non autorisée dans cet espace (niveau minimum : ${spaceClassification})` },
        { status: 400 }
      );
    }
  }

  // B69 : anciennes références /api/attachments/<clé> réécrites en /api/media/<id> à la
  // prochaine édition. Voie non collaborative seulement : si un état Yjs existe, il garderait
  // les anciennes références et les deux versions divergeraient, donc on ne réécrit pas.
  // Un échec ne bloque jamais la sauvegarde.
  if (content !== undefined && space && !doc.isFolder) {
    try {
      const [collab] = await db
        .select({ documentId: documentCollabStates.documentId })
        .from(documentCollabStates)
        .where(eq(documentCollabStates.documentId, id))
        .limit(1);
      if (!collab) {
        const result = await rewriteDocumentRefs(
          content,
          space.organizationId,
          createOrgKeyLookup(space.organizationId, doc.spaceId),
        );
        content = result.markdown;
      }
    } catch (err) {
      logger.warn({ err }, "[rewriteDocumentRefs] réécriture ignorée");
    }
  }

  // Sauvegarder le contenu sur le filesystem et git
  if (content !== undefined && space && !doc.isFolder) {
    await writeDocument(space.gitRepoPath, doc.filePath, content);
    await commitFile(
      space.gitRepoPath,
      doc.filePath,
      `Modification : ${doc.title}`,
      user.name,
      user.email
    );

    // PERF-10 — Batch wiki-links resolution (élimine le N+1)
    const wikiLinks = parseWikiLinks(content);

    // Supprimer les anciens liens
    await db
      .delete(documentLinks)
      .where(eq(documentLinks.sourceId, id));

    // Résoudre tous les slugs en une seule requête
    if (wikiLinks.length > 0) {
      const slugs = [...new Set(wikiLinks.map((l) => l.target))];
      const targetDocs = await db
        .select({ id: documents.id, slug: documents.slug })
        .from(documents)
        .where(inArray(documents.slug, slugs));

      const slugToId = new Map(targetDocs.map((d) => [d.slug, d.id]));

      const linksToInsert = wikiLinks
        .filter((link) => slugToId.has(link.target))
        .map((link) => ({
          sourceId: id,
          targetId: slugToId.get(link.target)!,
          linkText: link.linkText,
        }));

      if (linksToInsert.length > 0) {
        await db.insert(documentLinks).values(linksToInsert).onConflictDoNothing();
      }
    }
  }

  // Mettre a jour en BDD
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (title) updateData.title = title;
  if (visibility) updateData.visibility = visibility;
  if (classification) updateData.classification = classification;
  if (content !== undefined) updateData.contentText = content;
  if (icon !== undefined) updateData.icon = icon;
  if (properties !== undefined) updateData.properties = properties;

  const [updated] = await db
    .update(documents)
    .set(updateData)
    .where(eq(documents.id, id))
    .returning(documentMetadataColumns);

  // Indexer les embeddings en arrière-plan (non bloquant)
  if (content !== undefined) {
    indexDocument(id).catch((err) =>
      logger.error({ err }, "[indexDocument] Erreur indexation embeddings")
    );
  }

  // Détection des nouvelles @mentions dans le contenu
  if (content !== undefined) {
    // TipTap mention nodes serialized as @[Name](uuid) in markdown
    const mentionRegex =
      /@\[[^\]]*\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;
    const oldContent = doc.contentText || "";
    const oldMentions = new Set(
      [...oldContent.matchAll(mentionRegex)].map((m) => m[1])
    );
    const newMentions = [...content.matchAll(mentionRegex)]
      .map((m) => m[1])
      .filter((uid) => !oldMentions.has(uid));

    if (newMentions.length > 0) {
      createNotifications(newMentions, {
        type: "mention",
        title: `${user.name} vous a mentionné dans « ${updated.title} »`,
        documentId: id,
        actorId: user.id,
      }).catch((err) =>
        logger.error({ err }, "[mention notification] Erreur envoi notifications de mention")
      );
    }
  }

  // Activity log
  logActivity({
    userId: user.id,
    action: "update",
    entityType: "document",
    entityId: id,
    metadata: { title: updated.title },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await params;

  // Récupérer le document avant suppression
  const [doc] = await db
    .select({ title: documents.title, spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);

  if (!doc) return NextResponse.json({ error: "Document non trouvé" }, { status: 404 });

  // Vérifier les permissions d'édition
  const canEdit = await checkDocumentEditAccess(user, doc.spaceId, id);
  if (!canEdit) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  await deleteDocumentTree(id);

  logActivity({
    userId: user.id,
    action: "delete",
    entityType: "document",
    entityId: id,
    metadata: { title: doc?.title },
  });

  return NextResponse.json({ success: true });
}
