import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import { userDatabaseColumns, userDatabaseRows } from "@/lib/db/schema";
import { listVisibleViews, type ViewRow } from "@/lib/databases/view-access";
import { defaultCrmDeps, loadConnection, type CrmDeps, type ResolvedConnection } from "./connection";
import { CRM_ROLES, type CrmRole } from "./fields";
import type { FieldState } from "./validate";

export interface ColumnDto {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface CrmRow {
  id: string;
  databaseId: string;
  cells: Record<string, unknown>;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrmContext {
  orgId: string;
  userId: string;
  columns: Record<CrmRole, ColumnDto[]>;
  fieldColumn: (role: CrmRole, key: string) => string | null;
  /** Etat de validation du champ raccorde (`bad` : colonne disparue, mauvais type, mauvaise cible). */
  fieldState: (role: CrmRole, key: string) => FieldState["state"];
  databaseId: (role: CrmRole) => string;
  spaceId: (role: CrmRole) => string;
  canEdit: (role: CrmRole) => boolean;
}

function asConfig(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Champs d'un role qu'un ecran exige et qui ne sont pas utilisables (non raccordes ou en etat `bad`).
 * Les ecrans l'exposent a l'interface pour afficher l'etat de connexion incomplete.
 */
export function missingFields(ctx: CrmContext, role: CrmRole, keys: readonly string[]): string[] {
  return keys.filter((k) => ctx.fieldColumn(role, k) === null);
}

/** Contextes emis par `loadCrmContext` : seuls ceux-la sont acceptes par les lecteurs. */
const issued = new WeakSet<object>();

function assertIssued(ctx: CrmContext): void {
  if (!issued.has(ctx)) throw new Error("CrmContext non emis par loadCrmContext");
}

/** Contexte derive d'un contexte emis (surcharges de lecture ou de droit, tests) : reste emis. */
export function deriveCrmContext(ctx: CrmContext, patch: Partial<CrmContext>): CrmContext {
  assertIssued(ctx);
  const derived: CrmContext = { ...ctx, ...patch };
  issued.add(derived);
  return derived;
}

/**
 * Contexte d'une requete CRM. `null` (404 uniforme) si la connexion est absente, desactivee,
 * ou si l'un des trois roles n'est pas raccorde et lisible (base de l'organisation, vivante,
 * permission viewer) par l'utilisateur. Un champ obligatoire en etat `bad` ne rend PAS le
 * contexte nul : `fieldColumn` renvoie alors `null` pour ce champ et les lectures par
 * identifiant restent bornees a la base du role. Toute la verification d'acces passe par
 * `loadConnection` (organisation puis permission d'espace).
 */
export async function loadCrmContext(
  orgId: string,
  userId: string,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<CrmContext | null> {
  const read = await loadConnection(orgId, userId, "viewer", deps);
  if (!read || !read.enabled) return null;
  for (const role of CRM_ROLES) {
    const r = read.roles[role];
    if (!r.connected || !r.databaseId || !r.spaceId) return null;
  }
  const write: ResolvedConnection | null = await loadConnection(orgId, userId, "editor", deps);

  const dbIds = CRM_ROLES.map((r) => read.roles[r].databaseId as string);
  const colRows = await deps.executor
    .select({
      id: userDatabaseColumns.id,
      databaseId: userDatabaseColumns.databaseId,
      name: userDatabaseColumns.name,
      type: userDatabaseColumns.type,
      config: userDatabaseColumns.config,
    })
    .from(userDatabaseColumns)
    .where(inArray(userDatabaseColumns.databaseId, dbIds))
    .orderBy(asc(userDatabaseColumns.position));
  const columns = { contacts: [], dossiers: [], interactions: [] } as Record<CrmRole, ColumnDto[]>;
  for (const role of CRM_ROLES) {
    const dbId = read.roles[role].databaseId;
    columns[role] = colRows
      .filter((c) => c.databaseId === dbId)
      .map((c) => ({ id: c.id, name: c.name, type: String(c.type), config: asConfig(c.config) }));
  }

  const ctx: CrmContext = {
    orgId,
    userId,
    columns,
    fieldColumn(role, key) {
      const f = read.roles[role].fields[key];
      if (!f || f.state !== "ok") return null;
      return read.roles[role].columnIds[key] ?? null;
    },
    fieldState: (role, key) => read.roles[role].fields[key]?.state ?? "none",
    databaseId: (role) => read.roles[role].databaseId as string,
    spaceId: (role) => read.roles[role].spaceId as string,
    // Le droit editor ne vaut que pour la base effectivement lue : si la connexion a change
    // entre les deux chargements, on refuse plutot que d'ecrire dans une autre base.
    canEdit: (role) =>
      !!write?.roles[role]?.connected && write.roles[role].databaseId === read.roles[role].databaseId,
  };
  issued.add(ctx);
  return ctx;
}

/** Lignes de la base du role seulement (jamais d'identifiant de base venant du client), triees par position. */
export async function readRoleRows(
  ctx: CrmContext,
  role: CrmRole,
  deps: CrmDeps = defaultCrmDeps(),
  extra?: SQL,
): Promise<CrmRow[]> {
  assertIssued(ctx);
  const rows = await deps.executor
    .select()
    .from(userDatabaseRows)
    .where(and(eq(userDatabaseRows.databaseId, ctx.databaseId(role)), extra))
    .orderBy(asc(userDatabaseRows.position), asc(userDatabaseRows.createdAt));
  return rows.map((r) => ({
    id: r.id,
    databaseId: r.databaseId,
    cells: asConfig(r.cells),
    position: r.position,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Vues visibles de l'utilisateur sur Dossiers (partagees + ses personnelles). */
export async function readRoleViews(ctx: CrmContext, deps: CrmDeps = defaultCrmDeps()): Promise<ViewRow[]> {
  assertIssued(ctx);
  return listVisibleViews(deps.executor, ctx.databaseId("dossiers"), ctx.userId);
}
