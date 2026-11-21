import { isModuleActive } from "@/lib/modules/enablement";

/**
 * Conservé pour compatibilité : délègue désormais au kernel de modules.
 * Le toggle reste stocké sous la clé legacy "meeting_rooms_enabled"
 * (cf. manifeste meeting-rooms, champ toggleKey).
 *
 * @param orgId borne facultative : plan effectif de l'organisation ciblée.
 *   Absent = seule la licence d'instance décide (comportement historique).
 */
export async function isMeetingRoomsEnabled(
  orgId?: string | null
): Promise<boolean> {
  return isModuleActive("meeting-rooms", orgId);
}
