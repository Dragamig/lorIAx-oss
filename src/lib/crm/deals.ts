import { eq, sql } from "drizzle-orm";
import { userDatabaseRows } from "@/lib/db/schema";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { missingFields, readRoleRows, type ColumnDto, type CrmContext, type CrmRow } from "./context";
import { contactReader, toDeal, toInteraction, type ContactDto, type DealDto, type InteractionDto } from "./deal-model";
import { interactionLogging, loadDealTotals } from "./relances";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DealSheetDto {
  deal: DealDto;
  contact: ContactDto | null;
  row: CrmRow;
  columns: ColumnDto[];
  databaseId: string;
  spaceId: string;
  canEdit: boolean;
  contactRow: CrmRow | null;
  contactColumns: ColumnDto[];
  interactionTypes: string[];
  canLog: boolean;
  /** Champ Compte rendu raccordé : le formulaire d'interaction propose un commentaire. */
  canNote: boolean;
  /** Droit d'écriture sur Interactions (faux : lecture seule ; avec canLog faux : raccordement incomplet). */
  canEditInteractions: boolean;
  /** Colonnes raccordées (null : champ non raccordé, la section ou le titre correspondant est absent). */
  titleColumnId: string | null;
  relanceColumnId: string | null;
  contactColumnId: string | null;
  contactTitleColumnId: string | null;
  contactDatabaseId: string;
  contactSpaceId: string;
  missing: string[];
}

/** Ligne de la base Dossiers de la connexion, jamais une autre base (rowId vient du client). */
async function readDealRow(ctx: CrmContext, rowId: string, deps: CrmDeps): Promise<CrmRow | null> {
  if (!UUID_RE.test(rowId)) return null;
  const [row] = await readRoleRows(ctx, "dossiers", deps, eq(userDatabaseRows.id, rowId));
  return row ?? null;
}

/** Interactions du dossier : date décroissante (sans date en dernier), puis position, puis création. */
async function readDealInteractions(ctx: CrmContext, rowId: string, deps: CrmDeps): Promise<InteractionDto[]> {
  const col = ctx.fieldColumn("interactions", "dossier");
  if (col === null) return [];
  const rows = await readRoleRows(
    ctx,
    "interactions",
    deps,
    sql`${userDatabaseRows.cells} -> ${col}::text @> ${JSON.stringify([rowId])}::jsonb`,
  );
  return rows
    .map((r) => toInteraction(r, ctx.fieldColumn))
    .filter((i) => i.dealId === rowId)
    .map((it, index) => ({ it, index }))
    .sort((a, b) => {
      const da = a.it.date ?? "";
      const db = b.it.date ?? "";
      if (da !== db) return da < db ? 1 : -1;
      return a.index - b.index; // readRoleRows trie déjà par position puis création
    })
    .map((x) => x.it);
}

export async function loadDeal(
  ctx: CrmContext,
  rowId: string,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<DealSheetDto | null> {
  const row = await readDealRow(ctx, rowId, deps);
  if (!row) return null;
  const { amountOf } = await loadDealTotals(ctx, deps);
  const deal = toDeal(row, ctx.fieldColumn, amountOf);
  const contactRow =
    deal.contactId && UUID_RE.test(deal.contactId)
      ? ((await readRoleRows(ctx, "contacts", deps, eq(userDatabaseRows.id, deal.contactId)))[0] ?? null)
      : null;
  return {
    deal,
    contact: contactRow ? contactReader(ctx)(contactRow) : null,
    row,
    columns: ctx.columns.dossiers,
    databaseId: ctx.databaseId("dossiers"),
    spaceId: ctx.spaceId("dossiers"),
    canEdit: ctx.canEdit("dossiers"),
    contactRow,
    contactColumns: ctx.columns.contacts,
    titleColumnId: ctx.fieldColumn("dossiers", "titre"),
    relanceColumnId: ctx.fieldColumn("dossiers", "relance"),
    contactColumnId: ctx.fieldColumn("dossiers", "contact"),
    contactTitleColumnId: ctx.fieldColumn("contacts", "nom"),
    contactDatabaseId: ctx.databaseId("contacts"),
    contactSpaceId: ctx.spaceId("contacts"),
    missing: missingFields(ctx, "dossiers", ["titre", "statut", "relance"]),
    ...interactionLogging(ctx),
    canEditInteractions: ctx.canEdit("interactions"),
    canNote: ctx.fieldColumn("interactions", "compte_rendu") !== null,
  };
}

export async function listDealInteractions(
  ctx: CrmContext,
  rowId: string,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<InteractionDto[] | null> {
  const row = await readDealRow(ctx, rowId, deps);
  if (!row) return null;
  return readDealInteractions(ctx, rowId, deps);
}
