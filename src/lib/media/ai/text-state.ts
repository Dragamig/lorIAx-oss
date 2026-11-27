import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaTexts } from "@/lib/db/schema";
import type { MediaTextSource, MediaTextStatus } from "@/lib/db/schema";
import { extractableKind } from "./extract";
import { getMediaAiSettings } from "./settings";

/** Taille maximale d'une page de texte rendue (caractères). */
export const TEXT_PAGE_MAX = 50_000;

export type MediaTextState = {
  status: MediaTextStatus | "disabled" | "unsupported";
  reason: string | null;
  source: MediaTextSource | null;
  /** Page de texte, présente seulement quand `status === "done"`. */
  text: string | null;
  /** Le texte indexé a été tronqué au plafond d'indexation. */
  truncated: boolean;
  indexedAt: string | null;
  version: number | null;
  /** Pagination : taille totale, début de la page, début de la page suivante (null = fin). */
  totalChars: number;
  offset: number;
  nextOffset: number | null;
};

const EMPTY = { reason: null, source: null, text: null, truncated: false, indexedAt: null, version: null, totalChars: 0, offset: 0, nextOffset: null } as const;

export async function getMediaTextState(
  m: { id: string; organizationId: string; mimeType: string; filename: string },
  page: { offset?: number; limit?: number } = {},
): Promise<MediaTextState> {
  if (!extractableKind(m.mimeType, m.filename)) return { ...EMPTY, status: "unsupported" };
  const settings = await getMediaAiSettings(m.organizationId);
  if (!settings.indexEnabled) return { ...EMPTY, status: "disabled" };

  const [row] = await db
    .select()
    .from(mediaTexts)
    .where(eq(mediaTexts.mediaId, m.id))
    .limit(1);
  if (!row || row.organizationId !== m.organizationId) return { ...EMPTY, status: "pending", reason: null };

  const base = {
    status: row.status,
    reason: row.reason ?? null,
    source: row.source ?? null,
    truncated: row.truncated,
    indexedAt: row.indexedAt ? row.indexedAt.toISOString() : null,
    version: row.version,
  };
  if (row.status !== "done" || row.text == null) {
    return { ...base, text: null, totalChars: 0, offset: 0, nextOffset: null };
  }
  const offset = Math.max(0, Math.floor(page.offset ?? 0));
  const limit = Math.min(TEXT_PAGE_MAX, Math.max(1, Math.floor(page.limit ?? TEXT_PAGE_MAX)));
  const total = row.text.length;
  const slice = row.text.slice(offset, offset + limit);
  const end = offset + slice.length;
  return { ...base, text: slice, totalChars: total, offset, nextOffset: end < total ? end : null };
}
