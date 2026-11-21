import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkDocumentEditAccess } from "@/lib/auth/check-access";
import { guardVoiceNotesModule } from "@/lib/voice-notes/guards";
import {
  createVoiceNote,
  serializeVoiceNoteWithAvailability,
} from "@/lib/voice-notes/store";

const createSchema = z.object({
  documentId: z.string().uuid("documentId doit être un UUID"),
});

// POST /api/voice-notes : crée une note vocale vide dans un document
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const moduleBlocked = await guardVoiceNotesModule(user);
  if (moduleBlocked) return moduleBlocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Les droits sont portés par le document parent, jamais par la note.
  const [document] = await db
    .select({ id: documents.id, spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, parsed.data.documentId))
    .limit(1);

  if (!document) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }

  const canEdit = await checkDocumentEditAccess(user, document.spaceId, document.id);
  if (!canEdit) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const note = await createVoiceNote({
    documentId: document.id,
    createdBy: user.id,
  });

  // Bloc neuf : la réponse porte la disponibilité du moteur, sinon l'écran
  // « moteur indisponible » ne serait jamais atteint avant l'envoi de l'audio.
  return NextResponse.json(await serializeVoiceNoteWithAvailability(note), {
    status: 201,
  });
}
