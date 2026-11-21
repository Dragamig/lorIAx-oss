import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardVoiceNotesModule } from "@/lib/voice-notes/guards";
import { loadVoiceNoteWithAccess } from "@/lib/voice-notes/access";
import { serializeVoiceNoteWithAvailability } from "@/lib/voice-notes/store";

// GET /api/voice-notes/[id] : état complet pour le rendu du bloc
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const moduleBlocked = await guardVoiceNotesModule(user);
  if (moduleBlocked) return moduleBlocked;

  const { id } = await params;
  const access = await loadVoiceNoteWithAccess(user, id, "view");
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Cette route décide de l'écran affiché au montage du bloc : elle porte donc
  // la disponibilité du moteur, pour que le bloc soit désactivé d'emblée quand
  // aucun moteur n'est configuré, et non après un enregistrement perdu.
  return NextResponse.json(await serializeVoiceNoteWithAvailability(access.note));
}
