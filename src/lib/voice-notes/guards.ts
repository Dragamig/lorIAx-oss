import { NextResponse } from "next/server";
import { guardModuleEnabled } from "@/lib/modules/guard";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import type { SessionUser } from "@/types";

/**
 * Refuse l'accès aux routes de notes vocales quand le module est inactif pour
 * l'organisation courante. Renvoie une réponse à retourner telle quelle, ou
 * null si le module est actif.
 */
export async function guardVoiceNotesModule(
  user: SessionUser
): Promise<NextResponse | null> {
  const orgId = await getRequestOrgId(user);
  return guardModuleEnabled("voice-notes", orgId);
}
