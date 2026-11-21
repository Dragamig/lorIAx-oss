/**
 * Comptage des références à l'ancienne forme `/api/attachments/<clé>` et de l'intégrité de la copie
 * attachments / studio_images vers media (B123, tâche 14).
 * Aucune connexion base ici : module pur, testable sans infrastructure.
 */
import * as Y from "yjs";
import { ATTACHMENT_RE, safeDecode } from "@/lib/media/rewrite-document-refs";

export type KeyStatus = "resolvable" | "missing" | "ambiguous";
export type CopyStatus = "copied_by_id" | "copied_by_key" | "copied_by_key_other_org" | "orphan_unreachable";

export const SURFACES = ["content_text", "yjs_state", "design_thumbnail", "cells", "timeline", "brand_logo"] as const;
export type Surface = (typeof SURFACES)[number];

/** Nombre de médias non supprimés qui portent la clé, dans le périmètre lisible du document. */
export function classifyKey(candidates: number): KeyStatus {
  if (candidates === 1) return "resolvable";
  if (candidates === 0) return "missing";
  return "ambiguous";
}

/**
 * Décision 4 du plan : une ligne est orpheline inaccessible si aucun média n'a le même id ni la même
 * clé (un média soft-supprimé de même id compte comme copié). Une clé portée par un média de la même
 * organisation est atteignable ; portée seulement par une autre organisation, l'objet existe mais l'alias
 * ne le résout pas depuis le document : comptée à part, non bloquante. Studio : l'id seul compte, la clé
 * de studio n'est pas servie par l'alias.
 */
export function classifyCopy(
  match: { idMatch: boolean; keyMatch: boolean; keyOtherOrg?: boolean },
  opts: { idOnly?: boolean } = {},
): CopyStatus {
  if (match.idMatch) return "copied_by_id";
  if (!opts.idOnly && match.keyMatch) return "copied_by_key";
  if (!opts.idOnly && match.keyOtherOrg) return "copied_by_key_other_org";
  return "orphan_unreachable";
}

export function legacyKeysInText(text: string | null | undefined): string[] {
  if (!text || !text.includes("/api/attachments/")) return [];
  const keys = new Set<string>();
  for (const m of text.matchAll(new RegExp(ATTACHMENT_RE.source, "g"))) {
    const key = safeDecode(m[1]);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function cellLegacyKeys(
  cells: Record<string, unknown>,
  cols: Array<{ id: string; type: "image" | "attachment" }>,
): string[] {
  const keys = new Set<string>();
  for (const col of cols) {
    const v = cells[col.id];
    if (col.type === "image" && typeof v === "string") {
      const m = /^\/api\/attachments\/([^?#]+)/.exec(v.trim());
      if (m) keys.add(safeDecode(m[1]));
    } else if (col.type === "attachment" && Array.isArray(v)) {
      for (const it of v) {
        const k = it && typeof it === "object" ? (it as { key?: unknown }).key : undefined;
        if (typeof k === "string" && k.trim() !== "") keys.add(k);
      }
    }
  }
  return [...keys];
}

export function timelineLegacyKeys(timeline: unknown): string[] {
  const keys = new Set<string>();
  const tracks = (timeline as { tracks?: unknown } | null)?.tracks;
  if (!Array.isArray(tracks)) return [];
  for (const t of tracks) {
    const clips = (t as { clips?: unknown } | null)?.clips;
    if (!Array.isArray(clips)) continue;
    for (const c of clips) {
      const o = c as { sourceKey?: unknown; mediaId?: unknown } | null;
      if (typeof o?.sourceKey === "string" && o.sourceKey !== "" && !o.mediaId) keys.add(o.sourceKey);
    }
  }
  return [...keys];
}

export function logoLegacyKeys(logos: unknown): string[] {
  if (!Array.isArray(logos)) return [];
  const keys = new Set<string>();
  for (const l of logos) {
    const url = (l as { url?: unknown } | null)?.url;
    if (typeof url === "string") legacyKeysInText(url).forEach((k) => keys.add(k));
  }
  return [...keys];
}

/** Clés portées par l'attribut `thumbnailUrl` des blocs design de l'état Yjs. */
export function designThumbnailKeys(ydoc: Y.Doc): string[] {
  const keys = new Set<string>();
  const walk = (node: Y.XmlFragment | Y.XmlElement) => {
    if (node instanceof Y.XmlElement) {
      const v = node.getAttribute("thumbnailUrl");
      if (typeof v === "string") legacyKeysInText(v).forEach((k) => keys.add(k));
    }
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) walk(child);
    }
  };
  walk(ydoc.getXmlFragment("default"));
  return [...keys];
}

export interface SurfaceCounts {
  resolvable: number;
  missing: number;
  ambiguous: number;
  /** Lignes (documents, projets, bases) qui portent au moins une référence. */
  rows: number;
}

export class LegacyTally {
  private counts = Object.fromEntries(
    SURFACES.map((s) => [s, { resolvable: 0, missing: 0, ambiguous: 0, rows: 0 }]),
  ) as Record<Surface, SurfaceCounts>;

  addRow(surface: Surface, keys: string[], status: (key: string) => KeyStatus): void {
    if (keys.length === 0) return;
    this.counts[surface].rows += 1;
    for (const k of keys) this.counts[surface][status(k)] += 1;
  }

  toJSON(): Record<Surface, SurfaceCounts> {
    return JSON.parse(JSON.stringify(this.counts));
  }
}

/**
 * Seules les orphelines d'attachments bloquent : une ligne studio_images sans média de même id est déjà
 * inaccessible (la route studio ne sert que media) et son archivage ne change rien pour l'utilisateur.
 */
export function exitCodeFor(orphans: { attachmentsOrphans: number }): 0 | 2 {
  return orphans.attachmentsOrphans > 0 ? 2 : 0;
}
