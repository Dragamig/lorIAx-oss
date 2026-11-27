import { eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";
import { createDatabaseRow } from "@/lib/databases/row-writes";
import { UUID_RE } from "@/lib/databases/row-request-context";
import type { RowChangeContext } from "@/lib/databases/row-change-context";
import { userDatabaseRows } from "@/lib/db/schema";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { readRoleRows, type CrmContext } from "./context";
import { readIsoDate, todayIn } from "./dates";
import { toInteraction, type InteractionDto } from "./deal-model";
import { interactionLogging } from "./relances";

/**
 * Pièces jointes non prises en charge : le format `{ kind, id, name }` n'est pas une valeur
 * d'attachement des Bases (`normalizeAttachments` le lit comme un hérité sans clé, non
 * résolvable). Le champ est donc refusé par le schéma strict (suite au backlog).
 */
export const interactionBody = z
  .object({
    type: z.string().min(1).max(200),
    title: z.string().max(200).optional(),
    date: z.string().max(40).optional(),
    note: z.string().max(5000).optional(),
  })
  .strict();
export type InteractionBody = z.infer<typeof interactionBody>;

/** Cellules de la nouvelle interaction ; les champs facultatifs non raccordés sont ignorés. */
export function buildInteractionCells(
  ctx: CrmContext,
  dealId: string,
  body: InteractionBody,
  today: string,
): Record<string, unknown> {
  const f = (key: string) => ctx.fieldColumn("interactions", key);
  const cells: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    const col = f(key);
    if (col !== null) cells[col] = value;
  };
  set("date", body.date === undefined ? today : readIsoDate(body.date));
  set("type", body.type);
  set("dossier", [dealId]);
  if (body.title !== undefined && body.title.trim() !== "") set("intitule", body.title);
  if (body.note !== undefined && body.note.trim() !== "") set("compte_rendu", body.note);
  return cells;
}

export type InteractionError = "invalid" | "invalid_type" | "field_incompatible";
export type InteractionWriteResult =
  | { status: "ok"; interaction: InteractionDto }
  | { status: "not_found" }
  | { status: "invalid_params" }
  | { status: "error"; code: InteractionError };

/**
 * Crée une interaction liée au dossier par le chemin générique des Bases (historique, relations
 * jumelées, automatismes). Droit : editor sur Interactions (`ctx.canEdit`) et lecture du dossier
 * dans la base Dossiers de la connexion.
 */
export async function createInteraction(
  ctx: CrmContext,
  dealId: string,
  rawBody: unknown,
  opts: { now?: Date; tz?: string; rowCtx: RowChangeContext },
  deps: CrmDeps = defaultCrmDeps(),
): Promise<InteractionWriteResult> {
  // Champ obligatoire raccorde mais incompatible (spec 7.4) : 400, seulement pour qui peut deja
  // ecrire dans Interactions (aucun oracle pour un lecteur seul, qui recoit le 404 uniforme).
  if (
    ctx.canEdit("interactions") &&
    UUID_RE.test(dealId) &&
    (["date", "type", "dossier"] as const).some((k) => ctx.fieldState("interactions", k) === "bad")
  ) {
    return { status: "error", code: "field_incompatible" };
  }
  const { interactionTypes, canLog } = interactionLogging(ctx);
  if (!canLog || !UUID_RE.test(dealId)) return { status: "not_found" };
  const [deal] = await readRoleRows(ctx, "dossiers", deps, eq(userDatabaseRows.id, dealId));
  if (!deal) return { status: "not_found" };

  // Le corps n'est validé qu'après l'accès, le droit d'écriture et l'existence du dossier.
  const parsed = interactionBody.safeParse(rawBody);
  if (!parsed.success) return { status: "invalid_params" };
  const body = parsed.data;
  if (!interactionTypes.includes(body.type)) return { status: "error", code: "invalid_type" };
  if (body.date !== undefined && readIsoDate(body.date) === null) return { status: "error", code: "invalid" };

  const today = todayIn(opts.now ?? new Date(), opts.tz);
  const created = await createDatabaseRow(
    ctx.databaseId("interactions"),
    buildInteractionCells(ctx, dealId, body, today),
    deps.executor,
    opts.rowCtx,
  );
  const cells = (created.cells ?? {}) as Record<string, unknown>;
  dispatchRowEvents({ databaseId: ctx.databaseId("interactions"), rowId: created.id, before: null, after: cells });
  return {
    status: "ok",
    interaction: toInteraction(
      {
        id: created.id,
        databaseId: created.databaseId,
        cells,
        position: created.position,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
      ctx.fieldColumn,
    ),
  };
}
