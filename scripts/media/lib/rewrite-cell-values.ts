/**
 * Fonctions pures de réécriture des valeurs de cellules (B70).
 * Une valeur n'est réécrite que si la résolution est sûre ; tout le reste est
 * laissé tel quel et compté. Aucune pièce jointe n'est jamais supprimée ni réordonnée.
 */
import { normalizeAttachments, normalizeImageCell } from "../../../src/lib/media/cell-values";
import type { LookupResult } from "./plan";
import type { RewriteOutcome } from "./report";

export function rewriteImageCell(
  value: unknown,
  lookup: (key: string) => LookupResult
): { next: unknown; outcome: RewriteOutcome } {
  const cell = normalizeImageCell(value);
  switch (cell.kind) {
    case "media":
      return { next: value, outcome: "already_new" };
    case "legacyKey": {
      const r = lookup(cell.key);
      if (r.status === "found") return { next: `/api/media/${r.media.id}`, outcome: "rewritten" };
      return { next: value, outcome: r.status === "ambiguous" ? "ambiguous" : "key_not_found" };
    }
    case "invalid":
      return { next: value, outcome: "unparseable" };
    default:
      return { next: value, outcome: "unchanged" };
  }
}

export interface AttachmentRewriteContext {
  lookupByKey: (key: string) => LookupResult;
  lookupByNameSizeInSpace: (f: { filename: string; mimeType: string; size: number }) => LookupResult;
}

export function rewriteAttachmentCell(
  value: unknown,
  ctx: AttachmentRewriteContext
): { next: unknown; outcomes: RewriteOutcome[] } {
  if (value === null || value === undefined) return { next: value, outcomes: ["unchanged"] };
  if (!Array.isArray(value)) return { next: value, outcomes: ["unparseable"] };
  if (value.length === 0) return { next: value, outcomes: ["unchanged"] };

  const outcomes: RewriteOutcome[] = [];
  let changed = false;
  const next = value.map((raw): unknown => {
    const { items, invalid } = normalizeAttachments([raw]);
    if (invalid > 0 || items.length !== 1) {
      outcomes.push("unparseable");
      return raw;
    }
    const item = items[0];
    if (item.kind === "media") {
      outcomes.push("already_new");
      return raw;
    }
    const legacy = item.value;
    let found: LookupResult;
    if (item.resolvable && legacy.key) {
      found = ctx.lookupByKey(legacy.key);
    } else if (legacy.filename && legacy.mimeType && legacy.size && legacy.size > 0) {
      found = ctx.lookupByNameSizeInSpace({
        filename: legacy.filename,
        mimeType: legacy.mimeType,
        size: legacy.size,
      });
    } else {
      outcomes.push("key_not_found");
      return raw;
    }
    if (found.status === "found") {
      outcomes.push("rewritten");
      changed = true;
      const m = found.media;
      const base = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      return {
        ...base,
        mediaId: m.id,
        filename: legacy.filename ?? m.filename ?? "",
        mimeType: m.mimeType ?? legacy.mimeType ?? "application/octet-stream",
        size: m.sizeBytes ?? legacy.size ?? 0,
      };
    }
    outcomes.push(found.status === "ambiguous" ? "ambiguous" : "key_not_found");
    return raw;
  });
  return { next: changed ? next : value, outcomes };
}
