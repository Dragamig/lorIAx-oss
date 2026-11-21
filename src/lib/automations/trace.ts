/**
 * Trace par étape d'une exécution d'automatisme (lot 6) : types, résolution des
 * entrées, rédaction des secrets, troncature et plafond de taille.
 *
 * Module pur (aucune I/O). Règles :
 *  - jamais de secret dans `inputs` ni `output` : masquage par NOM de clé
 *    (secret, token, mot de passe, en-têtes d'authentification, clés d'API…) ;
 *  - chaînes longues tronquées, profondeur et largeur bornées ;
 *  - taille totale de la trace plafonnée (`TRACE_MAX_BYTES`), troncature signalée.
 */
import { interpolate, placeholderRegex, type InterpolationPayload } from "@/lib/automations/interpolate";

export type StepStatus = "success" | "error" | "skipped" | "simulated";

export interface StepError {
  /** Message lisible. */
  message: string;
  /** Détail technique court (nom de l'erreur, première frame). */
  detail?: string;
}

export interface TraceStep {
  nodeId: string;
  kind: "action" | "condition" | "trigger";
  actionType?: string;
  status: StepStatus;
  durationMs: number;
  inputs?: unknown;
  output?: unknown;
  error?: StepError;
  /** Vrai si `inputs`/`output` ont été retirés pour tenir dans le plafond de la trace. */
  truncated?: boolean;
}

/** Identifiant réservé de l'entrée de trace du déclencheur (pas un nœud du graphe). */
export const TRIGGER_STEP_ID = "__trigger__";

export const TRACE_MAX_BYTES = 64 * 1024;
export const MASKED = "[masqué]";
const MAX_STRING = 500;
const MAX_DEPTH = 6;
const MAX_ITEMS = 30;

const SENSITIVE_KEY =
  /(secret|token|passw|passwd|pwd|authorization|api[-_]?key|apikey|cookie|credential|bearer|signature|private[-_]?key|jwt)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function truncateString(value: string, max = MAX_STRING): string {
  return value.length > max ? `${value.slice(0, max)}… [tronqué, ${value.length} car.]` : value;
}

/** Masque les secrets qui se glissent dans un texte libre (message d'erreur, URL). */
function scrubText(value: string): string {
  return value
    .replace(/(bearer\s+)[\w.~+/=-]+/gi, `$1${MASKED}`)
    .replace(/([?&](?:token|secret|key|api_?key|password|auth|signature)=)[^&\s]+/gi, `$1${MASKED}`);
}

/** Copie profonde rédigée : clés sensibles masquées, chaînes et collections bornées. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return truncateString(scrubText(value));
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[trop profond]";
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ITEMS) out.push(`… ${value.length - MAX_ITEMS} élément(s) de plus`);
    return out;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries.slice(0, MAX_ITEMS)) {
      out[k] = isSensitiveKey(k) ? MASKED : redact(v, depth + 1);
    }
    if (entries.length > MAX_ITEMS) out["…"] = `${entries.length - MAX_ITEMS} clé(s) de plus`;
    return out;
  }
  return String(value);
}

/** Entrée résolue d'un champ interpolé : jeton source et valeur obtenue. */
export interface ResolvedInput {
  source: string;
  resolved: string;
}

function resolveValue(value: unknown, ctx: InterpolationPayload, key: string, depth: number): unknown {
  if (isSensitiveKey(key)) return MASKED;
  if (typeof value === "string") {
    if (!placeholderRegex().test(value)) return value;
    return { source: value, resolved: interpolate(value, ctx) } satisfies ResolvedInput;
  }
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, ctx, "", depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, ctx, k, depth + 1);
    return out;
  }
  return value;
}

/**
 * Config d'une étape avec, pour chaque champ contenant un jeton `{{…}}`, le couple
 * `{ source, resolved }` (affichage « {{jeton}} → valeur »). Rédigée.
 */
export function resolveInputs(config: unknown, ctx: InterpolationPayload): unknown {
  return redact(resolveValue(config ?? {}, ctx, "", 0));
}

export function describeError(err: unknown): StepError {
  const e = err instanceof Error ? err : new Error(String(err));
  const frame = e.stack?.split("\n").find((l) => l.trim().startsWith("at "))?.trim();
  const detail = [e.name !== "Error" ? e.name : "Error", frame ? frame.slice(0, 160) : undefined]
    .filter(Boolean)
    .join(" ");
  return { message: truncateString(scrubText(e.message), 300), detail: truncateString(scrubText(detail), 240) };
}

function sizeOf(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

/**
 * Borne la taille totale : au-delà du plafond, les `inputs`/`output` des étapes
 * qui dépassent sont retirés et l'étape porte `truncated: true`. Les statuts,
 * durées et erreurs sont toujours conservés.
 */
export function capTrace(steps: TraceStep[], maxBytes = TRACE_MAX_BYTES): { steps: TraceStep[]; truncated: boolean } {
  let used = 0;
  let truncated = false;
  const out = steps.map((s) => {
    const full = sizeOf(s);
    if (used + full <= maxBytes) {
      used += full;
      return s;
    }
    truncated = true;
    const { inputs: _i, output: _o, ...light } = s;
    void _i;
    void _o;
    const reduced: TraceStep = { ...light, truncated: true };
    used += sizeOf(reduced);
    return reduced;
  });
  return { steps: out, truncated };
}
