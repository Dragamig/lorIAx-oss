import { NextResponse } from "next/server";
import { isModuleActive } from "./enablement";
import type { ModuleId } from "./types";

/**
 * Renvoie un 404 si le module est inactif, sinon null.
 * Généralise `meeting-rooms/guards.ts` : un module désactivé est
 * transparent du point de vue d'un client externe.
 */
export async function guardModuleEnabled(
  id: ModuleId,
  orgId?: string | null
): Promise<NextResponse | null> {
  if (await isModuleActive(id, orgId)) return null;
  return NextResponse.json({ error: `Module ${id} désactivé` }, { status: 404 });
}
