/**
 * Sources serveur du bloc Activité d'une fiche CRM : interactions et tâches.
 * Formes brutes (InteractionDto, tâche réduite) : la route fusionne via activity-model.
 */
import { eq, or, sql, type SQL } from "drizzle-orm";
import { userDatabaseRows } from "@/lib/db/schema";
import { listRowTasks } from "@/lib/databases/row-tasks";
import type { DbExecutor } from "@/lib/databases/row-writes";
import { defaultCrmDeps, type CrmDeps } from "./connection";
import { readRoleRows, type CrmContext, type CrmRow } from "./context";
import { toInteraction, type InteractionDto } from "./deal-model";
import { toMailActivity, type ActivityTask } from "./activity-model";
import { listFicheMails, toMessageDto, type MailMessageDto } from "@/lib/mailing/threads";

export const ACTIVITY_SOURCE_LIMIT = 200;
export const MAIL_PREVIEW_LENGTH = 600;

export type ActivityScope = { kind: "deal"; rowId: string } | { kind: "contact"; rowId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const idsOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const containsId = (col: string, id: string): SQL =>
  sql`${userDatabaseRows.cells} -> ${col}::text @> ${JSON.stringify([id])}::jsonb`;

/** Date décroissante (sans date en dernier), puis ordre de lecture (position, création). */
function sortInteractions(list: InteractionDto[]): InteractionDto[] {
  return list
    .map((it, index) => ({ it, index }))
    .sort((a, b) => {
      const da = a.it.date ?? "";
      const db = b.it.date ?? "";
      if (da !== db) return da < db ? 1 : -1;
      return a.index - b.index;
    })
    .map((x) => x.it);
}

/** Null si la fiche n'existe pas dans la base du rôle de la connexion (jamais une autre base). */
export async function loadActivityInteractions(
  ctx: CrmContext,
  scope: ActivityScope,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<InteractionDto[] | null> {
  if (!UUID_RE.test(scope.rowId)) return null;
  const dossierCol = ctx.fieldColumn("interactions", "dossier");

  if (scope.kind === "deal") {
    const [deal] = await readRoleRows(ctx, "dossiers", deps, eq(userDatabaseRows.id, scope.rowId));
    if (!deal) return null;
    if (dossierCol === null) return [];
    const rows = await readRoleRows(ctx, "interactions", deps, containsId(dossierCol, scope.rowId));
    const list = rows.map((r) => toInteraction(r, ctx.fieldColumn)).filter((i) => i.dealId === scope.rowId);
    return sortInteractions(list).slice(0, ACTIVITY_SOURCE_LIMIT);
  }

  const [contact] = await readRoleRows(ctx, "contacts", deps, eq(userDatabaseRows.id, scope.rowId));
  if (!contact) return null;
  const contactCol = ctx.fieldColumn("interactions", "contact");
  const dealContactCol = ctx.fieldColumn("dossiers", "contact");

  let dealIds = new Set<string>();
  if (dealContactCol !== null && dossierCol !== null) {
    const deals = await readRoleRows(ctx, "dossiers", deps, containsId(dealContactCol, scope.rowId));
    dealIds = new Set(deals.filter((d) => idsOf(d.cells[dealContactCol])[0] === scope.rowId).map((d) => d.id));
  }

  const conds: SQL[] = [];
  if (contactCol !== null) conds.push(containsId(contactCol, scope.rowId));
  if (dossierCol !== null) for (const id of dealIds) conds.push(containsId(dossierCol, id));
  if (conds.length === 0) return [];

  const rows: CrmRow[] = await readRoleRows(ctx, "interactions", deps, or(...conds));
  const list = rows
    .filter((r) => {
      if (contactCol !== null && idsOf(r.cells[contactCol]).includes(scope.rowId)) return true;
      if (dossierCol === null) return false;
      return idsOf(r.cells[dossierCol]).some((id) => dealIds.has(id));
    })
    .map((r) => toInteraction(r, ctx.fieldColumn));
  return sortInteractions(list).slice(0, ACTIVITY_SOURCE_LIMIT);
}

/** Vrai si la ligne existe dans la base Dossiers de la connexion (jamais une autre base). */
export async function dealExists(ctx: CrmContext, rowId: string, deps: CrmDeps = defaultCrmDeps()): Promise<boolean> {
  if (!UUID_RE.test(rowId)) return false;
  const rows = await readRoleRows(ctx, "dossiers", deps, eq(userDatabaseRows.id, rowId));
  return rows.length > 0;
}

/** Tâches liées à la ligne, réduites au format du modèle d'activité. */
export async function loadActivityTasks(
  executor: DbExecutor,
  args: { databaseId: string; rowId: string },
): Promise<ActivityTask[]> {
  const tasks = await listRowTasks(executor, args);
  return tasks.slice(0, ACTIVITY_SOURCE_LIMIT).map((t) => ({
    id: t.id, title: t.title, dueAt: t.dueAt, status: t.status,
    assigneeId: t.assignee?.id ?? null,
    createdBy: t.createdBy,
  }));
}

/**
 * Mails de l'utilisateur sur la fiche (cloisonnés par organisation ET propriétaire dans listFicheMails).
 * Aperçu seulement : corps HTML vidé, texte tronqué, copies cachées jamais exposées.
 * Annulés et entrants écartés ; la fusion (mergeActivity) rejoue le même filtre, sans effet.
 */
export async function loadActivityMails(
  orgId: string,
  userId: string,
  scope: ActivityScope,
): Promise<MailMessageDto[]> {
  const rows = await listFicheMails(
    orgId,
    userId,
    scope.kind === "deal"
      ? { kind: "dossier", dossierRowId: scope.rowId }
      : { kind: "contact", contactRowId: scope.rowId },
  );
  const out: MailMessageDto[] = [];
  for (const row of rows) {
    if (row.direction === "in") continue;
    const item = toMailActivity(toMessageDto(row));
    if (item === null) continue;
    out.push({
      ...item.mail,
      bodyHtml: "",
      bcc: [],
      bodyText: item.mail.bodyText.slice(0, MAIL_PREVIEW_LENGTH),
    });
  }
  // listFicheMails trie du plus ancien au plus récent : on garde les plus récents.
  return out.slice(-ACTIVITY_SOURCE_LIMIT);
}
