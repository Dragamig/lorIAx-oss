import { NextResponse } from "next/server";
import { isMeetingRoomsEnabled } from "./feature-flag";
import { getModuleScopeOrgId } from "@/lib/modules/org-context";

/**
 * Renvoie un 404 si le module Salles de réunion est désactivé.
 * Les routes API doivent appeler cette fonction en premier afin que
 * le module soit transparent du point de vue d'un client externe.
 */
export async function guardMeetingRoomsEnabled(): Promise<NextResponse | null> {
  try {
    const enabled = await isMeetingRoomsEnabled(await getModuleScopeOrgId());
    if (!enabled) {
      return NextResponse.json(
        { error: "Module Salles de réunion désactivé" },
        { status: 404 }
      );
    }
    return null;
  } catch (error) {
    console.error('Feature flag check failed', error);
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}
