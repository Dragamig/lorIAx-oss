import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { organizationMembers, tasks, userDatabaseRows, users } from "@/lib/db/schema";
import { resolveTotalsConfig } from "@/lib/bases/kanban";
import { normalizeOptions } from "@/components/editor/extensions/database-block/options";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { missingFields, readRoleRows, readRoleViews, type CrmContext } from "./context";
import { addDaysIso, relanceBucket, todayIn } from "./dates";
import { filterDeals, contactReader, isOpenDeal, toDeal, toInteraction, type DealDto } from "./deal-model";
import { defaultTotalsConfig, pickTotalsSource } from "./pipeline-config";

export interface RelanceItem {
  dealId: string;
  title: string;
  status: string | null;
  contactName: string | null;
  contactOrg: string | null;
  relance: string;
  lastInteraction: { date: string | null; type: string | null; title: string | null } | null;
}

export interface RelanceTask {
  id: string;
  title: string;
  dueAt: string | null;
  dealId: string;
  dealTitle: string;
  assigneeName: string | null;
}

export interface RelancesDto {
  groups: { late: RelanceItem[]; today: RelanceItem[]; week: RelanceItem[] };
  tasks: RelanceTask[];
  interactionTypes: string[];
  canLog: boolean;
  mineAvailable: boolean;
  canEdit: boolean;
  missing: string[];
}

export interface RelancesQuery {
  horizon: number;
  mine: boolean;
  tz?: string;
  now?: Date;
}

const DAY_MS = 86_400_000;

function dayOf(date: Date, tz: string | undefined): string {
  return todayIn(date, tz);
}

/** Statuts clos et évaluateur de montant (colonne formule) issus de la vue Pipeline, ou du repli. */
export async function loadDealTotals(ctx: CrmContext, deps: CrmDeps) {
  const views = await readRoleViews(ctx, deps);
  const amountCol = ctx.fieldColumn("dossiers", "montant");
  const source = pickTotalsSource(views, amountCol);
  const totals = source.config ?? defaultTotalsConfig(amountCol);
  const amountOf = totals ? resolveTotalsConfig(ctx.columns.dossiers, { kanbanTotals: totals }).active?.amountOf : undefined;
  return { closed: totals?.closedLanes ?? [], amountOf, currency: totals?.currency ?? "EUR" };
}

/** Options du Type d'interaction et droit de saisie d'une interaction (F7). */
export function interactionLogging(ctx: CrmContext): { interactionTypes: string[]; canLog: boolean } {
  const typeCol = ctx.fieldColumn("interactions", "type");
  const typeColumn = ctx.columns.interactions.find((c) => c.id === typeCol);
  return {
    interactionTypes: typeColumn ? normalizeOptions(typeColumn.config.options) : [],
    canLog:
      ctx.canEdit("interactions") &&
      typeCol !== null &&
      ctx.fieldColumn("interactions", "date") !== null &&
      ctx.fieldColumn("interactions", "dossier") !== null,
  };
}

/** Dossiers ouverts (statuts clos de la vue Pipeline exclus), restreints aux miens si demandé. */
export async function loadOpenDeals(ctx: CrmContext, mine: boolean, deps: CrmDeps) {
  const mineAvailable = ctx.fieldColumn("dossiers", "responsable") !== null;
  const [rows, { closed, amountOf, currency }] = await Promise.all([readRoleRows(ctx, "dossiers", deps), loadDealTotals(ctx, deps)]);
  const deals = rows.map((r) => toDeal(r, ctx.fieldColumn, amountOf));
  const kept = filterDeals(deals, {
    mine: mine && mineAvailable ? { userId: ctx.userId } : null,
    closed,
    today: "",
  }).filter((d) => isOpenDeal(d, closed));
  return { deals: kept, mineAvailable, currency };
}

export async function loadRelances(
  ctx: CrmContext,
  q: RelancesQuery,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<RelancesDto> {
  const tz = q.tz;
  const today = todayIn(q.now ?? new Date(), tz);
  const { deals, mineAvailable } = await loadOpenDeals(ctx, q.mine, deps);

  const [contactRows, interactionRows] = await Promise.all([
    readRoleRows(ctx, "contacts", deps),
    readRoleRows(ctx, "interactions", deps),
  ]);
  const readContact = contactReader(ctx);
  const contacts = new Map(contactRows.map((r) => [r.id, readContact(r)]));
  const lastByDeal = new Map<string, RelanceItem["lastInteraction"] & { sort: string }>();
  for (const r of interactionRows) {
    const it = toInteraction(r, ctx.fieldColumn);
    if (!it.dealId) continue;
    const sort = it.date ?? "";
    const prev = lastByDeal.get(it.dealId);
    if (!prev || sort > prev.sort) lastByDeal.set(it.dealId, { date: it.date, type: it.type, title: it.title, sort });
  }

  const groups: RelancesDto["groups"] = { late: [], today: [], week: [] };
  const sorted = deals
    .filter((d): d is DealDto & { relance: string } => d.relance !== null)
    .sort((a, b) => a.relance.localeCompare(b.relance) || a.title.localeCompare(b.title, "fr"));
  for (const d of sorted) {
    const bucket = relanceBucket(d.relance, today, q.horizon);
    if (bucket !== "late" && bucket !== "today" && bucket !== "week") continue;
    const contact = d.contactId ? (contacts.get(d.contactId) ?? null) : null;
    const last = lastByDeal.get(d.id) ?? null;
    groups[bucket].push({
      dealId: d.id,
      title: d.title,
      status: d.status,
      contactName: contact?.name ?? null,
      contactOrg: contact?.org ?? null,
      relance: d.relance,
      lastInteraction: last ? { date: last.date, type: last.type, title: last.title } : null,
    });
  }

  const dealById = new Map(deals.map((d) => [d.id, d]));
  const taskRows = dealById.size === 0 ? [] : await loadDueTasks(ctx, [...dealById.keys()], today, q.horizon, tz, deps);
  const taskDtos: RelanceTask[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    dueAt: t.dueAt ? t.dueAt.toISOString() : null,
    dealId: t.rowId as string,
    dealTitle: dealById.get(t.rowId as string)?.title ?? "",
    assigneeName: t.assigneeName,
  }));

  return {
    groups,
    tasks: taskDtos,
    ...interactionLogging(ctx),
    mineAvailable,
    canEdit: ctx.canEdit("dossiers"),
    missing: missingFields(ctx, "dossiers", ["titre", "relance"]),
  };
}

/**
 * Tâches ouvertes liées à une ligne de la base Dossiers de la connexion, en une seule requête,
 * échues avant la fin de l'horizon (jour du fuseau). Jointure sur la ligne existante de cette base.
 */
async function loadDueTasks(
  ctx: CrmContext,
  dealIds: string[],
  today: string,
  horizon: number,
  tz: string | undefined,
  deps: CrmDeps,
) {
  const dbId = ctx.databaseId("dossiers");
  // Borne SQL large (marge de fuseau), le jour exact est tranché ensuite dans le fuseau demandé.
  const upper = new Date(Date.parse(`${addDaysIso(today, horizon + 2)}T00:00:00Z`) + DAY_MS);
  const rows = await deps.executor
    .select({
      id: tasks.id,
      title: tasks.title,
      dueAt: tasks.dueAt,
      rowId: tasks.rowId,
      assigneeName: users.name,
    })
    .from(tasks)
    .innerJoin(
      userDatabaseRows,
      and(eq(userDatabaseRows.id, tasks.rowId), eq(userDatabaseRows.databaseId, dbId)),
    )
    .leftJoin(
      organizationMembers,
      and(eq(organizationMembers.userId, tasks.assigneeId), eq(organizationMembers.organizationId, ctx.orgId)),
    )
    .leftJoin(users, eq(users.id, organizationMembers.userId))
    .where(
      and(
        eq(tasks.kind, "database_row"),
        eq(tasks.databaseId, dbId),
        inArray(tasks.status, ["open", "in_progress"]),
        isNotNull(tasks.dueAt),
        lte(tasks.dueAt, upper),
        inArray(tasks.rowId, dealIds),
      ),
    )
    .orderBy(sql`${tasks.dueAt} ASC`, tasks.id);
  const last = addDaysIso(today, horizon);
  return rows.filter((r) => r.dueAt && dayOf(r.dueAt, tz) <= last);
}

/** Mes dossiers ouverts dont la relance est échue ou du jour. 0 sans responsable ni relance raccordés. */
export async function countRelances(
  ctx: CrmContext,
  q: { tz?: string; now?: Date },
  deps: CrmDeps = defaultCrmDeps(),
): Promise<number> {
  if (ctx.fieldColumn("dossiers", "responsable") === null || ctx.fieldColumn("dossiers", "relance") === null) {
    return 0;
  }
  const today = todayIn(q.now ?? new Date(), q.tz);
  const { deals } = await loadOpenDeals(ctx, true, deps);
  return deals.filter((d) => {
    const b = relanceBucket(d.relance, today, 0);
    return b === "late" || b === "today";
  }).length;
}
