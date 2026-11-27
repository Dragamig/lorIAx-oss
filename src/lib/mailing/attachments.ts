/**
 * Resolution des pieces jointes d'un mail : octets lus au stockage apres controle
 * d'appartenance. Un televersement doit vivre sous `mail/<org>/<user>/` ; un media
 * est relu en base (organisation, droit de lecture) et sa cle de stockage vient de
 * la base, jamais du client.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import type { MailAttachmentRef } from "@/lib/db/schema-mailing";
import { getMediaFull, resolveMediaAccess } from "@/lib/media/access";
import { readFileBytes } from "@/lib/storage/s3";
import { withCurrentKey } from "@/lib/media/current-key";
import type { SessionUser } from "@/types";

export const MAX_MAIL_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

export type AttachmentErrorCode = "missing" | "too_large" | "forbidden";

export class AttachmentError extends Error {
  constructor(public readonly code: AttachmentErrorCode) {
    super(code);
  }
}

export interface ResolvedAttachment {
  fileName: string;
  mimeType: string;
  size: number;
  content: Buffer;
}

export const uploadPrefix = (orgId: string, userId: string) => `mail/${orgId}/${userId}/`;

export function isUserUploadKey(key: string, orgId: string, userId: string): boolean {
  return key.startsWith(uploadPrefix(orgId, userId)) && !key.split("/").includes("..");
}

async function loadSessionUser(userId: string): Promise<SessionUser> {
  const [u] = await db
    .select({ id: users.id, email: users.email, name: users.name, globalRole: users.globalRole, capabilities: users.capabilities })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) throw new AttachmentError("forbidden");
  return { id: u.id, email: u.email, name: u.name, globalRole: u.globalRole, capabilities: [...u.capabilities] };
}

async function read(key: string): Promise<Buffer> {
  let bytes: Buffer | null;
  try {
    bytes = await readFileBytes(key);
  } catch {
    throw new AttachmentError("missing");
  }
  if (!bytes) throw new AttachmentError("missing");
  return bytes;
}

export async function resolveAttachments(
  orgId: string,
  userId: string,
  refs: MailAttachmentRef[],
): Promise<ResolvedAttachment[]> {
  if (refs.reduce((s, r) => s + (Number.isFinite(r.size) ? r.size : 0), 0) > MAX_MAIL_ATTACHMENTS_BYTES) {
    throw new AttachmentError("too_large");
  }
  let user: SessionUser | null = null;
  const out: ResolvedAttachment[] = [];
  let total = 0;

  for (const ref of refs) {
    let key: string;
    let fileName = ref.fileName;
    let mimeType = ref.mimeType;
    if (ref.source === "upload") {
      if (!isUserUploadKey(ref.storageKey, orgId, userId)) throw new AttachmentError("forbidden");
      key = ref.storageKey;
    } else {
      if (!ref.mediaId) throw new AttachmentError("forbidden");
      const row = await getMediaFull(ref.mediaId);
      if (!row || row.organizationId !== orgId) throw new AttachmentError("forbidden");
      user ??= await loadSessionUser(userId);
      const access = await resolveMediaAccess(user, row, "read", { orgId });
      if (!access.allowed) throw new AttachmentError("forbidden");
      key = row.storageKey;
      fileName = ref.fileName || row.filename;
      mimeType = row.mimeType;
    }
    // Un média remplacé entre-temps : la clé courante est relue en base avant d'abandonner.
    const mediaId = ref.source === "media" ? ref.mediaId : undefined;
    const content = mediaId
      ? await withCurrentKey(
          async (): Promise<string> => {
            const fresh = await getMediaFull(mediaId);
            if (!fresh) throw new AttachmentError("missing");
            return fresh.storageKey;
          },
          read
        )
      : await read(key);
    total += content.length;
    if (total > MAX_MAIL_ATTACHMENTS_BYTES) throw new AttachmentError("too_large");
    out.push({ fileName, mimeType, size: content.length, content });
  }
  return out;
}
