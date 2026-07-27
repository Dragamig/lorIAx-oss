import { db } from "@/lib/db";
import { attachments, documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkDocumentViewAccess, checkSpaceViewAccess } from "@/lib/auth/check-access";
import type { SessionUser } from "@/types";

/**
 * H8 - Access control for stored attachments.
 *
 * The attachment routes used to hand any S3 object key straight to the bucket, so a
 * guessed or observed key was readable by any authenticated account. Every read now
 * has to go through this module: the key is resolved in the `attachments` table, then
 * the owning document (or, failing that, the owning space) drives the decision with
 * the regular access helpers. A key that is not registered in the table is refused.
 */

export interface ResolvedAttachment {
  id: string;
  storageKey: string;
  filename: string;
  mimeType: string;
  spaceId: string;
  documentId: string | null;
}

export type AttachmentAccessResult =
  | { ok: true; attachment: ResolvedAttachment }
  /** Key unknown to the database: never serve it. */
  | { ok: false; reason: "not_found" }
  /** Key known but the caller may not read the owning document or space. */
  | { ok: false; reason: "forbidden" };

/** Look up an attachment by its S3 object key. */
async function findByStorageKey(storageKey: string): Promise<ResolvedAttachment | null> {
  const [row] = await db
    .select({
      id: attachments.id,
      storageKey: attachments.storageKey,
      filename: attachments.filename,
      mimeType: attachments.mimeType,
      spaceId: attachments.spaceId,
      documentId: attachments.documentId,
    })
    .from(attachments)
    .where(eq(attachments.storageKey, storageKey))
    .limit(1);

  return row ?? null;
}

/**
 * Read permission on an attachment.
 *
 * Attached to a document: the document view check applies (RBAC + classification).
 * Attached to a space only (database blocks, orphaned attachments after a document
 * deletion): the decision is delegated to checkSpaceViewAccess() in "member" mode,
 * the very rule that governs the database rows carrying those attachments
 * (src/app/api/databases/[databaseId]/route.ts). Reimplementing it here with
 * getSpacePermission() made the attachment stricter than the row that displays it:
 * a user whose access comes from a team permission saw the cell and got a 403 when
 * opening it.
 */
async function canRead(user: SessionUser, attachment: ResolvedAttachment): Promise<boolean> {
  if (attachment.documentId) {
    const [doc] = await db
      .select({ id: documents.id, spaceId: documents.spaceId })
      .from(documents)
      .where(eq(documents.id, attachment.documentId))
      .limit(1);

    // The document may have been moved to another space since the upload, so the
    // check uses the document's current space, not the one stored on the attachment.
    if (doc) return checkDocumentViewAccess(user, doc.spaceId, doc.id);
  }

  return checkSpaceViewAccess(user, attachment.spaceId, "member");
}

/**
 * Resolve an S3 object key into an attachment the caller is allowed to read.
 * Single entry point for the attachment serving routes.
 */
export async function resolveReadableAttachment(
  user: SessionUser,
  storageKey: string
): Promise<AttachmentAccessResult> {
  const attachment = await findByStorageKey(storageKey);
  if (!attachment) return { ok: false, reason: "not_found" };

  const allowed = await canRead(user, attachment);
  if (!allowed) return { ok: false, reason: "forbidden" };

  return { ok: true, attachment };
}
