/**
 * Contexte de déclencheur conservé dans le payload d'un run pour le rejeu.
 *
 * Module pur. Le contexte est copié (jamais la référence vivante, que la marche
 * du graphe enrichit), purgé des clés sensibles par NOM (jeton, secret, mot de
 * passe, en-têtes) et plafonné. Les chaînes ne sont PAS tronquées : un rejeu
 * doit voir les mêmes données que l'original.
 */
import { isSensitiveKey } from "@/lib/automations/trace";
import type { ExecutionContext } from "@/lib/automations/actions/types";

export const REPLAY_MAX_BYTES = 64 * 1024;
const MAX_DEPTH = 12;
const DROPPED_KEYS = /^(headers?|cookies?)$/i;

export type ReplaySnapshot = Partial<ExecutionContext> | { unavailable: true };

function scrub(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(k) || DROPPED_KEYS.test(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

/** Copie rédigée du contexte de déclencheur ; `{ unavailable: true }` au-delà du plafond. */
export function snapshotTriggerContext(ctx: ExecutionContext): ReplaySnapshot {
  const copy = scrub(ctx, 0) as Partial<ExecutionContext>;
  let size = 0;
  try {
    size = Buffer.byteLength(JSON.stringify(copy), "utf-8");
  } catch {
    return { unavailable: true };
  }
  return size > REPLAY_MAX_BYTES ? { unavailable: true } : copy;
}

/** Contexte rejouable lu dans le payload d'un run, ou null si absent / indisponible. */
export function replayContextFromPayload(payload: unknown): ExecutionContext | null {
  const snap = (payload as { replay?: unknown } | null | undefined)?.replay;
  if (!snap || typeof snap !== "object") return null;
  if ((snap as { unavailable?: boolean }).unavailable) return null;
  return snap as ExecutionContext;
}
