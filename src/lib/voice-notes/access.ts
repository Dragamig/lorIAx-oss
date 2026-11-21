import { db } from "@/lib/db";
import { documents, type VoiceNote } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  checkDocumentViewAccess,
  checkDocumentEditAccess,
} from "@/lib/auth/check-access";
import type { SessionUser } from "@/types";
import { getVoiceNote, reconcileStalledVoiceNote } from "./store";

export type VoiceNoteAccessMode = "view" | "edit";

export type VoiceNoteAccess =
  | { ok: true; note: VoiceNote; documentId: string; spaceId: string }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Charge une note, remonte à son document parent et délègue le contrôle au
 * contrôle d'accès documentaire.
 *
 * Règle : c'est le document qui porte les droits. L'identifiant de note ne vaut
 * jamais autorisation, sinon un UUID deviné donnerait accès à une note d'une
 * autre organisation.
 */
export async function loadVoiceNoteWithAccess(
  user: SessionUser,
  noteId: string,
  mode: VoiceNoteAccessMode
): Promise<VoiceNoteAccess> {
  const note = await getVoiceNote(noteId);
  if (!note) return { ok: false, status: 404, error: "Note vocale introuvable" };

  const [document] = await db
    .select({ id: documents.id, spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, note.documentId))
    .limit(1);

  if (!document) {
    return { ok: false, status: 404, error: "Document introuvable" };
  }

  const allowed =
    mode === "edit"
      ? await checkDocumentEditAccess(user, document.spaceId, document.id)
      : await checkDocumentViewAccess(user, document.spaceId, document.id);

  if (!allowed) return { ok: false, status: 403, error: "Accès refusé" };

  // Un travail de fond abandonné (transcription ou traitement IA) est
  // requalifié ici, une fois les droits vérifiés : toutes les routes repartent
  // du même état réel.
  const current = await reconcileStalledVoiceNote(note);

  return {
    ok: true,
    note: current,
    documentId: document.id,
    spaceId: document.spaceId,
  };
}
