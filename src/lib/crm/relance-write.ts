import { eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";
import { mergeDatabaseRowCells } from "@/lib/databases/row-writes";
import { UUID_RE } from "@/lib/databases/row-request-context";
import type { RowChangeContext } from "@/lib/databases/row-change-context";
import { userDatabaseRows } from "@/lib/db/schema";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { readRoleRows, type CrmContext } from "./context";
import { addDaysIso, isPastDate, readIsoDate, todayIn } from "./dates";

/** Une seule forme : date, faite, report, ou restauration (annulation, date passée acceptée). */
export const relanceBody = z.union([
  z.object({ date: z.string().max(40) }).strict(),
  z.object({ done: z.literal(true) }).strict(),
  z.object({ snoozeDays: z.number().int().min(1).max(365) }).strict(),
  z.object({ restore: z.string().max(40).nullable() }).strict(),
]);
export type RelanceBody = z.infer<typeof relanceBody>;

export type RelanceError = "past_date" | "invalid" | "no_relance" | "field_incompatible";
export type RelanceCell = { ok: true; value: string | null } | { ok: false; code: RelanceError };

export function computeRelanceCell(body: RelanceBody, current: string | null, today: string): RelanceCell {
  if ("done" in body) return { ok: true, value: null };
  if ("restore" in body) {
    if (body.restore === null) return { ok: true, value: null };
    const d = readIsoDate(body.restore);
    return d === null ? { ok: false, code: "invalid" } : { ok: true, value: d };
  }
  if ("date" in body) {
    const d = readIsoDate(body.date);
    if (d === null) return { ok: false, code: "invalid" };
    return isPastDate(d, today) ? { ok: false, code: "past_date" } : { ok: true, value: d };
  }
  const cur = current === null ? null : readIsoDate(current);
  if (cur === null) return { ok: false, code: "no_relance" };
  const base = isPastDate(cur, today) ? today : cur;
  return { ok: true, value: addDaysIso(base, body.snoozeDays) };
}

export type RelanceWriteResult =
  | { status: "ok"; relance: string | null }
  | { status: "not_found" }
  | { status: "invalid_params" }
  | { status: "error"; code: RelanceError };

/**
 * Ecrit la relance d'un dossier par le chemin generique des Bases (historique, relations
 * jumelees, automatismes). Droit d'ecriture : `ctx.canEdit`, issu du chargement editor.
 */
export async function writeRelance(
  ctx: CrmContext,
  rowId: string,
  rawBody: unknown,
  opts: { now?: Date; tz?: string; rowCtx: RowChangeContext },
  deps: CrmDeps = defaultCrmDeps(),
): Promise<RelanceWriteResult> {
  // Acces, contexte et droit d'ecriture d'abord : un lecteur seul recoit toujours le 404 uniforme.
  if (!ctx.canEdit("dossiers") || !UUID_RE.test(rowId)) return { status: "not_found" };
  // Champ raccorde mais incompatible (spec 7.4) : 400, seulement pour qui peut deja ecrire.
  if (ctx.fieldState("dossiers", "relance") === "bad") return { status: "error", code: "field_incompatible" };
  const col = ctx.fieldColumn("dossiers", "relance");
  if (col === null) return { status: "not_found" };
  const [before] = await readRoleRows(ctx, "dossiers", deps, eq(userDatabaseRows.id, rowId));
  if (!before) return { status: "not_found" };

  // Le corps n'est validé qu'après l'accès, le droit d'écriture et l'existence du dossier.
  const parsedBody = relanceBody.safeParse(rawBody);
  if (!parsedBody.success) return { status: "invalid_params" };
  const body = parsedBody.data;

  const currentRaw = readIsoDate(before.cells[col]);
  const today = todayIn(opts.now ?? new Date(), opts.tz);
  const computed = computeRelanceCell(body, currentRaw, today);
  if (!computed.ok) return { status: "error", code: computed.code };
  // Valeur inchangee : aucune ecriture, aucune entree d'historique, aucun automatisme.
  if (computed.value === currentRaw) return { status: "ok", relance: computed.value };

  const updated = await mergeDatabaseRowCells(
    ctx.databaseId("dossiers"),
    rowId,
    { [col]: computed.value },
    {},
    deps.executor,
    opts.rowCtx,
  );
  if (!updated) return { status: "not_found" };
  dispatchRowEvents({
    databaseId: ctx.databaseId("dossiers"),
    rowId: updated.id,
    before: before.cells,
    after: updated.cells as Record<string, unknown>,
  });
  return { status: "ok", relance: computed.value };
}
