import { normalizeOptions } from "@/components/editor/extensions/database-block/options";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { missingFields, readRoleRows, readRoleViews, type ColumnDto, type CrmContext } from "./context";
import { resolveTotalsConfig } from "@/lib/bases/kanban";
import { contactReader, toDeal, type DealDto } from "./deal-model";
import { defaultTotalsConfig, pickTotalsSource } from "./pipeline-config";
import { loadOwners } from "./pipeline";

export interface DossierDeal extends DealDto {
  contactName: string | null;
}

/** Colonnes raccordées de la base Dossiers (null : champ facultatif non raccordé). */
export interface DossiersFieldColumns {
  titre: string | null;
  statut: string | null;
  montant: string | null;
  relance: string | null;
  responsable: string | null;
  contact: string | null;
  cloture: string | null;
}

export interface DossiersDto {
  databaseId: string;
  spaceId: string;
  columns: ColumnDto[];
  rows: { id: string; cells: Record<string, unknown> }[];
  views: { id: string; name: string; type: string; scope: "shared" | "personal"; config: Record<string, unknown> }[];
  canEdit: boolean;
  closedLanes: string[];
  userId: string;
  deals: DossierDeal[];
  fieldColumns: DossiersFieldColumns;
  missing: string[];
  statuses: string[];
  owners: { id: string; name: string }[];
  mineAvailable: boolean;
  currency: string;
}

function asConfig(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function loadDossiers(
  ctx: CrmContext,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<DossiersDto> {
  const [rows, contactRows, views] = await Promise.all([
    readRoleRows(ctx, "dossiers", deps),
    readRoleRows(ctx, "contacts", deps),
    readRoleViews(ctx, deps),
  ]);
  const amountCol = ctx.fieldColumn("dossiers", "montant");
  const source = pickTotalsSource(views, amountCol);
  const totals = source.config ?? defaultTotalsConfig(amountCol);
  const closedLanes = totals?.closedLanes ?? [];
  const amountOf = totals ? resolveTotalsConfig(ctx.columns.dossiers, { kanbanTotals: totals }).active?.amountOf : undefined;
  const contactNames = new Map<string, string>();
  const readContact = contactReader(ctx);
  for (const r of contactRows) contactNames.set(r.id, readContact(r).name);
  const deals = rows.map((r) => {
    const deal = toDeal(r, ctx.fieldColumn, amountOf);
    return { ...deal, contactName: deal.contactId ? (contactNames.get(deal.contactId) ?? null) : null };
  });
  const statusId = ctx.fieldColumn("dossiers", "statut");
  const statusCol = ctx.columns.dossiers.find((c) => c.id === statusId);
  return {
    databaseId: ctx.databaseId("dossiers"),
    spaceId: ctx.spaceId("dossiers"),
    columns: ctx.columns.dossiers,
    rows: rows.map((r) => ({ id: r.id, cells: r.cells })),
    views: views.map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      scope: v.scope === "personal" ? "personal" : "shared",
      config: asConfig(v.config),
    })),
    canEdit: ctx.canEdit("dossiers"),
    closedLanes,
    userId: ctx.userId,
    deals,
    fieldColumns: {
      titre: ctx.fieldColumn("dossiers", "titre"),
      statut: statusId,
      montant: amountCol,
      relance: ctx.fieldColumn("dossiers", "relance"),
      responsable: ctx.fieldColumn("dossiers", "responsable"),
      contact: ctx.fieldColumn("dossiers", "contact"),
      cloture: ctx.fieldColumn("dossiers", "cloture"),
    },
    missing: missingFields(ctx, "dossiers", ["titre", "statut"]),
    statuses: normalizeOptions(statusCol?.config.options),
    owners: await loadOwners(ctx, deals.flatMap((d) => d.ownerIds), deps),
    mineAvailable: ctx.fieldColumn("dossiers", "responsable") !== null,
    currency: totals?.currency ?? "EUR",
  };
}
