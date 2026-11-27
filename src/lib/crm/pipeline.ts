import { and, eq, inArray } from "drizzle-orm";
import { organizationMembers } from "@/lib/db/schema-org";
import { users } from "@/lib/db/schema";
import { resolveTotalsConfig } from "@/lib/bases/kanban";
import type { KanbanTotalsConfig } from "@/lib/bases/view-config";
import { normalizeOptions } from "@/components/editor/extensions/database-block/options";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { missingFields, readRoleRows, readRoleViews, type ColumnDto, type CrmContext } from "./context";
import { todayIn } from "./dates";
import { contactReader, filterDeals, toDeal, type DealDto } from "./deal-model";
import { defaultTotalsConfig, pickTotalsSource } from "./pipeline-config";

export interface PipelineDeal extends DealDto {
  contactName: string | null;
  cells: Record<string, unknown>;
}

export interface PipelineDto {
  spaceId: string;
  databaseId: string;
  columns: ColumnDto[];
  /** `null` : colonne Statut non raccordée ou invalide, aucune écriture de statut n'est possible. */
  statusColumnId: string | null;
  amountColumnId: string | null;
  lanes: { key: string; label: string }[];
  deals: PipelineDeal[];
  totals: KanbanTotalsConfig | null;
  totalsViewId: string | null;
  mineAvailable: boolean;
  /** Champ Prochaine relance raccordé : le filtre « En retard » a un sens. */
  lateAvailable: boolean;
  canEdit: boolean;
  /** Champs exigés par l'écran et inutilisables (état de connexion incomplète). */
  missing: string[];
  owners: { id: string; name: string }[];
}

export interface PipelineQuery {
  mine: boolean;
  late: boolean;
  ownerId: string | null;
  tz?: string;
  now?: Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Responsables : seulement des membres de l'organisation, nom uniquement (jamais d'e-mail). */
export async function loadOwners(ctx: CrmContext, ids: string[], deps: CrmDeps) {
  const valid = [...new Set(ids)].filter((id) => UUID_RE.test(id));
  if (valid.length === 0) return [];
  const rows = await deps.executor
    .select({ id: users.id, name: users.name })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizationMembers.organizationId, ctx.orgId), inArray(organizationMembers.userId, valid)));
  return rows
    .map((r) => ({ id: r.id, name: r.name ?? "" }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function loadPipeline(
  ctx: CrmContext,
  q: PipelineQuery,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<PipelineDto> {
  const columns = ctx.columns.dossiers;
  const statusColumnId = ctx.fieldColumn("dossiers", "statut");
  const amountColumnId = ctx.fieldColumn("dossiers", "montant");
  const mineAvailable = ctx.fieldColumn("dossiers", "responsable") !== null;

  const [dealRows, contactRows, views] = await Promise.all([
    readRoleRows(ctx, "dossiers", deps),
    readRoleRows(ctx, "contacts", deps),
    readRoleViews(ctx, deps),
  ]);

  const source = pickTotalsSource(views, amountColumnId);
  const totals = source.config ?? defaultTotalsConfig(amountColumnId);
  const amountOf = totals
    ? resolveTotalsConfig(columns, { kanbanTotals: totals }).active?.amountOf
    : undefined;

  const contactNames = new Map<string, string>();
  const readContact = contactReader(ctx);
  for (const r of contactRows) contactNames.set(r.id, readContact(r).name);

  const all = dealRows.map((r) => ({ row: r, deal: toDeal(r, ctx.fieldColumn, amountOf) }));
  const kept = new Set(
    filterDeals(
      all.map((a) => a.deal),
      {
        mine: q.mine && mineAvailable ? { userId: ctx.userId } : null,
        late: q.late,
        ownerId: q.ownerId,
        closed: totals?.closedLanes ?? [],
        today: todayIn(q.now ?? new Date(), q.tz),
      },
    ).map((d) => d.id),
  );

  const statusCol = columns.find((c) => c.id === statusColumnId);
  const lanes = [
    ...normalizeOptions(statusCol?.config.options).map((o) => ({ key: o, label: o })),
    { key: "", label: "" },
  ];

  return {
    spaceId: ctx.spaceId("dossiers"),
    databaseId: ctx.databaseId("dossiers"),
    columns,
    statusColumnId,
    amountColumnId,
    lanes,
    deals: all
      .filter((a) => kept.has(a.deal.id))
      .map((a) => ({
        ...a.deal,
        contactName: a.deal.contactId ? (contactNames.get(a.deal.contactId) ?? null) : null,
        cells: a.row.cells,
      })),
    totals,
    totalsViewId: source.viewId,
    mineAvailable,
    lateAvailable: ctx.fieldColumn("dossiers", "relance") !== null,
    canEdit: ctx.canEdit("dossiers") && statusColumnId !== null,
    missing: missingFields(ctx, "dossiers", ["titre", "statut"]),
    owners: await loadOwners(ctx, all.flatMap((a) => a.deal.ownerIds), deps),
  };
}
