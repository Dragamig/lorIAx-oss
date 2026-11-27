import { db } from "@/lib/db";
import { aiToolCalls, type AiToolCallStatus } from "@/lib/db/schema-ai-proposals";
import { ToolAccessError, type ChatToolContext } from "./context";

const REDACTED = "[redacted]";
const ID_KEYS = new Set(["databaseId", "rowIds", "keyColumnIds", "columns"]);
const NORMALIZATION_KEYS = ["caseInsensitive", "trim", "collapseSpaces"] as const;
const GENERIC_ACCESS_ERROR =
  "Base introuvable ou accès refusé. Rappelle list_databases pour obtenir les identifiants et recopie-les à l'identique.";
const GENERIC_TOOL_ERROR = "Erreur interne de l'outil, réessayez plus tard";

function isIdLike(v: unknown): boolean {
  return typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function redactFilter(filter: Record<string, unknown>): Record<string, unknown> {
  const conditions = Array.isArray(filter.conditions) ? filter.conditions : [];
  return {
    conjunction: typeof filter.conjunction === "string" ? filter.conjunction : REDACTED,
    conditions: conditions.map((c) => {
      const cond = isRecord(c) ? c : {};
      return {
        columnId: typeof cond.columnId === "string" ? cond.columnId : REDACTED,
        operator: typeof cond.operator === "string" ? cond.operator : REDACTED,
        value: REDACTED,
      };
    }),
  };
}

/**
 * Arguments d'un appel d'outil prêts pour le journal : liste blanche
 * (identifiants, opérateurs et colonnes de filtre, `limit`, options de
 * normalisation). Toute autre valeur, notamment cellules et valeurs de
 * filtre, est remplacée par "[redacted]".
 */
export function redactToolArgs(_tool: string, args: unknown): Record<string, unknown> {
  if (!isRecord(args)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (ID_KEYS.has(key) && isIdLike(value)) out[key] = value;
    else if (key === "limit" && typeof value === "number") out[key] = value;
    else if (key === "filter" && isRecord(value)) out[key] = redactFilter(value);
    else if (key === "normalization" && isRecord(value)) {
      out[key] = Object.fromEntries(
        NORMALIZATION_KEYS.filter((k) => typeof value[k] === "boolean").map((k) => [k, value[k]]),
      );
    } else out[key] = REDACTED;
  }
  return out;
}

function proposalIdOf(result: unknown): string | null {
  if (isRecord(result) && typeof result.proposalId === "string") return result.proposalId;
  return null;
}

/**
 * Enveloppe un outil du chat : mesure la durée, journalise dans ai_tool_calls
 * (jamais de contenu de cellule) et renvoie au modèle un `{ error }` générique
 * plutôt qu'une exception. Une panne du journal n'affecte pas l'outil.
 */
export function withToolLog<TArgs, TResult>(
  ctx: ChatToolContext,
  tool: string,
  execute: (args: TArgs) => Promise<TResult>,
): (args: TArgs) => Promise<TResult> {
  return async (args: TArgs) => {
    const started = Date.now();
    let status: AiToolCallStatus = "ok";
    let result: unknown;
    try {
      result = await execute(args);
    } catch (e) {
      if (e instanceof ToolAccessError) {
        status = "refused";
        result = { error: GENERIC_ACCESS_ERROR };
      } else {
        status = "error";
        console.error(`[chat-tools] ${tool} a échoué`, e instanceof Error ? e.name : "unknown");
        result = { error: GENERIC_TOOL_ERROR };
      }
    }
    // Erreur logique renvoyée au modèle (ex. planification refusée) : pas "ok".
    if (status === "ok" && isRecord(result) && "error" in result) status = "error";

    try {
      await db.insert(aiToolCalls).values({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        tool,
        args: redactToolArgs(tool, args),
        status,
        durationMs: Date.now() - started,
        proposalId: proposalIdOf(result),
      });
    } catch {
      console.warn(`[chat-tools] journal ai_tool_calls indisponible pour ${tool}`);
    }
    return result as TResult;
  };
}
