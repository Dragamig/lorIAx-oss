import type { Media } from "@/lib/db/schema";
import { ORG_DAILY_MEDIA_MAX } from "./limits";
import { enqueueMediaIndex } from "./enqueue";
import { extractableKind } from "./extract";
import { indexedToday } from "./runner";
import { getMediaAiSettings } from "./settings";

export type ReindexResult =
  | { ok: true; status: "pending" }
  | { ok: false; status: 409 | 415 | 429; code: "index_disabled" | "unsupported" | "daily_cap"; error: string };

/** Remet un média en file d'indexation, sauf indexation désactivée, type sans extracteur ou plafond du jour atteint. */
export async function requestReindex(
  row: Pick<Media, "id" | "organizationId" | "mimeType" | "filename">,
): Promise<ReindexResult> {
  if (!extractableKind(row.mimeType, row.filename)) {
    return { ok: false, status: 415, code: "unsupported", error: "Ce type de fichier n'est pas indexable" };
  }
  const settings = await getMediaAiSettings(row.organizationId);
  if (!settings.indexEnabled) {
    return { ok: false, status: 409, code: "index_disabled", error: "L'indexation IA est désactivée pour l'organisation" };
  }
  if ((await indexedToday(row.organizationId, new Date())) >= ORG_DAILY_MEDIA_MAX) {
    return { ok: false, status: 429, code: "daily_cap", error: "Plafond quotidien d'indexation atteint, réessayez demain" };
  }
  await enqueueMediaIndex(row.id, "manual");
  return { ok: true, status: "pending" };
}
