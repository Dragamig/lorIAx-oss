import { createHash } from "crypto";
import type { Freshness, RowFingerprint } from "./types";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** SHA-256 d'une sérialisation JSON à clés triées (stable, indépendante de l'ordre des clés). */
export function hashCells(cells: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(cells)).digest("hex");
}

export function computeFingerprint(rows: { id: string; cells: Record<string, unknown> }[]): RowFingerprint[] {
  return rows
    .map((r) => ({ id: r.id, hash: hashCells(r.cells) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Vrai seulement si l'ensemble de lignes est identique (mêmes ids, mêmes hachages) et, quand l'empreinte
 * attendue porte `databaseRowCountForKey`, si ce compte est inchangé (une ligne qui rejoint un groupe de doublons).
 */
export function isFresh(expected: Freshness, current: Freshness): boolean {
  if (expected.rows.length !== current.rows.length) return false;
  const byId = new Map(current.rows.map((r) => [r.id, r.hash]));
  if (byId.size !== current.rows.length) return false;
  for (const r of expected.rows) {
    if (byId.get(r.id) !== r.hash) return false;
  }
  if (expected.databaseRowCountForKey !== undefined) {
    return expected.databaseRowCountForKey === current.databaseRowCountForKey;
  }
  return true;
}
