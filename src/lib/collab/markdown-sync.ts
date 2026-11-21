import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { writeDocument } from "@/lib/storage/filesystem";
import { commitFile } from "@/lib/git/repository";
import { spaces } from "@/lib/db/schema";
import { checkCollabDocumentEditAccess } from "./auth-ws";
import { syncDocumentTasks } from "@/lib/tasks/sync-document-tasks";
import type { JSONContent } from "@tiptap/core";
import { serializeAtomicNode } from "@/lib/documents/atomic-markdown";
import logger from "@/lib/logger";

/**
 * Extract Markdown content from a Yjs document.
 * Uses prosemirror JSON serialization then converts to markdown.
 * Falls back to plain text extraction.
 */
export function extractTextFromYDoc(ydoc: Y.Doc, options: { images?: boolean } = {}): string {
  try {
    const json = yDocToProsemirrorJSON(ydoc, "default");
    return prosemirrorJsonToMarkdown(json, options);
  } catch {
    // Fallback: extract text from Yjs XML fragment
    const xmlFragment = ydoc.getXmlFragment("default");
    return xmlFragment.toString();
  }
}

/**
 * Simple ProseMirror JSON → Markdown converter.
 * Handles the most common node types.
 */
export function prosemirrorJsonToMarkdown(
  json: Record<string, unknown>,
  options: { images?: boolean } = {},
): string {
  const content = json.content as Array<Record<string, unknown>> | undefined;
  if (!content) return "";

  // `images: false` reproduit le convertisseur antérieur à B123 (les images disparaissent) ; usage réservé à la
  // comparaison du script media:rewrite-collab. Appel synchrone : le drapeau ne fuit pas entre appels.
  const previous = renderImages;
  renderImages = options.images !== false;
  try {
    return content.map(nodeToMarkdown).join("\n");
  } finally {
    renderImages = previous;
  }
}

let renderImages = true;

function nodeToMarkdown(node: Record<string, unknown>): string {
  const type = node.type as string;
  const content = node.content as Array<Record<string, unknown>> | undefined;
  const attrs = node.attrs as Record<string, unknown> | undefined;

  const atomic = serializeAtomicNode(node);
  if (atomic !== null) return atomic + "\n";

  switch (type) {
    case "paragraph":
      return inlineContent(content) + "\n";

    case "heading": {
      const level = (attrs?.level as number) || 1;
      return "#".repeat(level) + " " + inlineContent(content) + "\n";
    }

    case "bulletList":
      return (content || [])
        .map((item) => {
          const inner = (item.content as Array<Record<string, unknown>> | undefined) || [];
          return "- " + inner.map(nodeToMarkdown).join("").trim();
        })
        .join("\n") + "\n";

    case "orderedList":
      return (content || [])
        .map((item, i) => {
          const inner = (item.content as Array<Record<string, unknown>> | undefined) || [];
          return `${i + 1}. ` + inner.map(nodeToMarkdown).join("").trim();
        })
        .join("\n") + "\n";

    case "taskList":
      return (content || [])
        .map((item) => {
          const checked = (item.attrs as Record<string, unknown>)?.checked ? "x" : " ";
          const inner = (item.content as Array<Record<string, unknown>> | undefined) || [];
          return `- [${checked}] ` + inner.map(nodeToMarkdown).join("").trim();
        })
        .join("\n") + "\n";

    case "codeBlock": {
      const lang = (attrs?.language as string) || "";
      return "```" + lang + "\n" + inlineContent(content) + "\n```\n";
    }

    case "blockquote":
      return (content || [])
        .map((c) => "> " + nodeToMarkdown(c).trim())
        .join("\n") + "\n";

    case "horizontalRule":
      return "---\n";

    case "hardBreak":
      return "\n";

    case "image":
      return renderImages ? imageToMarkdown(attrs) + "\n" : "";

    default:
      return inlineContent(content);
  }
}

/** `![alt](src "title")` ; `src` est écrit tel quel, sans transformation. */
function imageToMarkdown(attrs: Record<string, unknown> | undefined): string {
  const rawSrc = typeof attrs?.src === "string" ? attrs.src : "";
  if (!rawSrc) return "";
  // Une image base64 ne s'écrit pas dans le Markdown (volume, blobs Git, RAG) : on garde l'alt et un src vide.
  const src = rawSrc.startsWith("data:") ? "" : rawSrc;
  const alt = typeof attrs?.alt === "string" ? attrs.alt.replace(/([\\\[\]])/g, "\\$1") : "";
  const title = typeof attrs?.title === "string" && attrs.title ? attrs.title : "";
  const titlePart = title ? ` "${title.replace(/(["\\])/g, "\\$1")}"` : "";
  return `![${alt}](${src}${titlePart})`;
}

function inlineContent(content: Array<Record<string, unknown>> | undefined): string {
  if (!content) return "";
  return content
    .map((node) => {
      if (node.type === "text") {
        let text = node.text as string;
        const marks = node.marks as Array<Record<string, unknown>> | undefined;
        if (marks) {
          for (const mark of marks) {
            switch (mark.type) {
              case "bold":
              case "strong":
                text = `**${text}**`;
                break;
              case "italic":
              case "em":
                text = `*${text}*`;
                break;
              case "code":
                text = "`" + text + "`";
                break;
              case "link": {
                const href = (mark.attrs as Record<string, unknown>)?.href || "";
                text = `[${text}](${href})`;
                break;
              }
            }
          }
        }
        return text;
      }
      if (node.type === "hardBreak") return "\n";
      if (node.type === "image") return !renderImages ? "" : imageToMarkdown(node.attrs as Record<string, unknown> | undefined);
      const atomic = serializeAtomicNode(node);
      if (atomic !== null) return atomic;
      return inlineContent(node.content as Array<Record<string, unknown>> | undefined);
    })
    .join("");
}

/**
 * Persist the Yjs document content to the file system and git.
 * This maintains compatibility with the existing storage system.
 *
 * @param userId — if provided, re-checks edit permissions before writing (C5).
 *   Omitted for onDisconnect flush (final flush, data already in Yjs state).
 * @param orgId — organisation portée par le jeton WebSocket de l'auteur, requise
 *   dès que `userId` est fourni : la re-vérification applique le cloisonnement
 *   multi-tenant (cf. `checkCollabDocumentEditAccess`). Absente ⇒ refus.
 * @param options, réglages pour un appelant hors ligne (script de réécriture) :
 *   message et auteur du commit Git, et `touchUpdatedAt: false` pour conserver
 *   `updatedAt`. Les valeurs par défaut reproduisent l'auto-sauvegarde collaborative.
 * @returns vrai si la base et le disque ont été écrits ; faux en cas de refus,
 *   de document introuvable ou d'échec (journalisé, jamais levé).
 */
export interface SyncYjsOptions {
  commitMessage?: string;
  author?: { name: string; email: string };
  touchUpdatedAt?: boolean;
}

export async function syncYjsToStorage(
  documentId: string,
  ydoc: Y.Doc,
  userId?: string,
  orgId?: string | null,
  options: SyncYjsOptions = {}
): Promise<boolean> {
  const touchUpdatedAt = options.touchUpdatedAt ?? true;
  try {
    // Re-validate edit permissions if userId is provided (C5)
    if (userId) {
      const hasEditAccess = await checkCollabDocumentEditAccess(userId, documentId, orgId ?? null);
      if (!hasEditAccess) {
        logger.warn({ userId, documentId }, "[markdown-sync] Edit access revoked — sync blocked");
        return false;
      }
    }

    // Extract ProseMirror JSON once — used for both markdown and task sync
    let prosemirrorJson: JSONContent | null = null;
    try {
      prosemirrorJson = yDocToProsemirrorJSON(ydoc, "default") as JSONContent;
    } catch {
      // Will fall back to text extraction for markdown
    }

    const markdown = prosemirrorJson
      ? prosemirrorJsonToMarkdown(prosemirrorJson as Record<string, unknown>)
      : extractTextFromYDoc(ydoc);

    // Get document and space info
    const [doc] = await db
      .select({
        filePath: documents.filePath,
        spaceId: documents.spaceId,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);

    if (!doc) return false;

    const [space] = await db
      .select({ gitRepoPath: spaces.gitRepoPath })
      .from(spaces)
      .where(eq(spaces.id, doc.spaceId))
      .limit(1);

    if (!space) return false;

    // Update contentText in DB
    await db
      .update(documents)
      .set(touchUpdatedAt ? { contentText: markdown, updatedAt: new Date() } : { contentText: markdown })
      .where(eq(documents.id, documentId));

    // Write to filesystem
    await writeDocument(space.gitRepoPath, doc.filePath, markdown);

    // Git commit
    await commitFile(
      space.gitRepoPath,
      doc.filePath,
      options.commitMessage ?? `Auto-save: ${doc.title}`,
      options.author?.name ?? "LorIAx Collab",
      options.author?.email ?? "collab@loriax.local"
    );

    // Sync task items to DB (best-effort — ne bloque pas le storage)
    if (prosemirrorJson && userId) {
      syncDocumentTasks(documentId, prosemirrorJson, userId).catch((err) =>
        logger.warn({ err }, "[markdown-sync] Task sync échoué")
      );
    }
    return true;
  } catch (err) {
    logger.error({ err }, "[markdown-sync] Erreur sync Yjs vers storage");
    return false;
  }
}
