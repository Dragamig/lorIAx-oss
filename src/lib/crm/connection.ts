import { and, eq, inArray, isNull, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { spaces, userDatabases, userDatabaseColumns } from "@/lib/db/schema";
import { crmConnections } from "@/lib/db/schema-crm";
import { getSpacePermission } from "@/lib/auth/check-access";
import type { DbExecutor } from "@/lib/databases/row-writes";
import type { PermissionLevel } from "@/types";
import { automapRole, type ColumnFact } from "./automap";
import { CRM_FIELDS, CRM_ROLES, parseFieldMap, type CrmFieldMap, type CrmRole } from "./fields";
import { classifyCandidate, type CandidateStatus, type MissingColumn } from "./plan";
import { validateField, validateRole, type FieldState } from "./validate";

export interface CrmDeps {
  executor: DbExecutor;
  permissionOf: (userId: string, spaceId: string) => Promise<PermissionLevel | null>;
}

export function defaultCrmDeps(): CrmDeps {
  return { executor: db, permissionOf: getSpacePermission };
}

export interface ResolvedRole {
  role: CrmRole;
  connected: boolean;
  databaseId?: string;
  databaseName?: string;
  spaceId?: string;
  spaceName?: string;
  fields: Record<string, FieldState>;
  /** Colonne choisie par champ (lecture tolérante), pour réécrire le `field_map` complet. */
  columnIds: Record<string, string | null>;
  ok: number;
  total: number;
  bad: number;
  complete: boolean;
}

export interface ResolvedConnection {
  enabled: boolean;
  roles: Record<CrmRole, ResolvedRole>;
  okTotal: number;
  badTotal: number;
  complete: boolean;
}

export interface Candidate {
  databaseId: string;
  name: string;
  spaceId: string;
  spaceName: string;
  columns: ColumnFact[];
  proposal: Record<string, string | null>;
  score: number;
  /** Vrai exactement quand `status === "compatible"` (conservé pour les appelants existants). */
  compatible: boolean;
  status: CandidateStatus;
  missing: MissingColumn[];
}

const RANK: Record<string, number> = { viewer: 1, editor: 2, admin: 3 };

const ROLE_COLUMN = {
  contacts: "contactsDatabaseId",
  dossiers: "dealsDatabaseId",
  interactions: "interactionsDatabaseId",
} as const satisfies Record<CrmRole, string>;

interface BaseInfo {
  databaseId: string;
  name: string;
  spaceId: string;
  spaceName: string;
}

/** Cache local à un appel : jamais partagé entre appels ni utilisateurs. */
function makeResolver(orgId: string, userId: string, deps: CrmDeps) {
  const perms = new Map<string, Promise<PermissionLevel | null>>();
  const permissionOf = (spaceId: string) => {
    let p = perms.get(spaceId);
    if (!p) {
      p = deps.permissionOf(userId, spaceId);
      perms.set(spaceId, p);
    }
    return p;
  };
  const allows = async (spaceId: string, need: "viewer" | "editor") => {
    const level = await permissionOf(spaceId);
    return level !== null && (RANK[level] ?? 0) >= RANK[need];
  };
  /** Une requête : base vivante de l'organisation, puis permission seulement si elle passe. */
  const resolveBase = async (databaseId: string, need: "viewer" | "editor"): Promise<BaseInfo | null> => {
    const rows = await deps.executor
      .select({
        databaseId: userDatabases.id,
        name: userDatabases.name,
        spaceId: userDatabases.spaceId,
        spaceName: spaces.name,
      })
      .from(userDatabases)
      .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
      .where(
        and(
          eq(userDatabases.id, databaseId),
          isNull(userDatabases.deletedAt),
          isNull(userDatabases.archivedAt),
          eq(spaces.organizationId, orgId),
        ),
      )
      .limit(1);
    const base = rows[0];
    if (!base) return null;
    if (!(await allows(base.spaceId, need))) return null;
    return base;
  };
  return { resolveBase, allows };
}

export async function loadColumns(executor: DbExecutor, databaseIds: string[]) {
  const byDb = new Map<string, ColumnFact[]>();
  if (databaseIds.length === 0) return byDb;
  const rows = await executor
    .select({
      id: userDatabaseColumns.id,
      databaseId: userDatabaseColumns.databaseId,
      name: userDatabaseColumns.name,
      type: userDatabaseColumns.type,
      config: userDatabaseColumns.config,
    })
    .from(userDatabaseColumns)
    .where(inArray(userDatabaseColumns.databaseId, databaseIds))
    .orderBy(asc(userDatabaseColumns.position));
  for (const r of rows) {
    const cfg = r.config;
    const target =
      cfg && typeof cfg === "object" && !Array.isArray(cfg)
        ? (cfg as Record<string, unknown>).targetDatabaseId
        : undefined;
    const list = byDb.get(r.databaseId) ?? [];
    list.push({
      id: r.id,
      name: r.name,
      type: r.type,
      targetDatabaseId: typeof target === "string" ? target : null,
    });
    byDb.set(r.databaseId, list);
  }
  return byDb;
}

function disconnectedRole(role: CrmRole): ResolvedRole {
  const fields: Record<string, FieldState> = {};
  for (const def of CRM_FIELDS[role]) fields[def.key] = { state: "none" };
  return { role, connected: false, fields, columnIds: {}, ok: 0, total: CRM_FIELDS[role].length, bad: 0, complete: false };
}

export async function loadConnection(
  orgId: string,
  userId: string,
  need: "viewer" | "editor",
  deps: CrmDeps = defaultCrmDeps(),
): Promise<ResolvedConnection | null> {
  const [row] = await deps.executor
    .select()
    .from(crmConnections)
    .where(eq(crmConnections.organizationId, orgId))
    .limit(1);
  if (!row) return null;

  const { resolveBase } = makeResolver(orgId, userId, deps);
  const fieldMap = parseFieldMap(row.fieldMap);

  const bases: Partial<Record<CrmRole, BaseInfo>> = {};
  for (const role of CRM_ROLES) {
    const id = row[ROLE_COLUMN[role]];
    if (!id) continue;
    const base = await resolveBase(id, need);
    if (base) bases[role] = base;
  }
  const columnsByDb = await loadColumns(
    deps.executor,
    Object.values(bases).map((b) => b.databaseId),
  );
  const targets: Partial<Record<CrmRole, string | null>> = {};
  for (const role of CRM_ROLES) targets[role] = bases[role]?.databaseId ?? null;

  const roles = {} as Record<CrmRole, ResolvedRole>;
  let okTotal = 0;
  let badTotal = 0;
  let complete = true;
  for (const role of CRM_ROLES) {
    const base = bases[role];
    if (!base) {
      roles[role] = disconnectedRole(role);
      complete = false;
      continue;
    }
    const v = validateRole(role, fieldMap[role] ?? {}, columnsByDb.get(base.databaseId) ?? [], targets);
    roles[role] = {
      role,
      connected: true,
      databaseId: base.databaseId,
      databaseName: base.name,
      spaceId: base.spaceId,
      spaceName: base.spaceName,
      columnIds: { ...(fieldMap[role] ?? {}) },
      ...v,
    };
    okTotal += v.ok;
    badTotal += v.bad;
    if (!v.complete) complete = false;
  }
  return { enabled: row.enabled, roles, okTotal, badTotal, complete };
}

export async function listCandidates(
  orgId: string,
  userId: string,
  role: CrmRole | null,
  deps: CrmDeps = defaultCrmDeps(),
  opts: { fieldLabel?: (role: CrmRole, key: string) => string; relationTargetKnown?: boolean } = {},
): Promise<Candidate[]> {
  const { allows } = makeResolver(orgId, userId, deps);
  const rows = await deps.executor
    .select({
      databaseId: userDatabases.id,
      name: userDatabases.name,
      spaceId: userDatabases.spaceId,
      spaceName: spaces.name,
    })
    .from(userDatabases)
    .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
    .where(
      and(
        isNull(userDatabases.deletedAt),
        isNull(userDatabases.archivedAt),
        eq(spaces.organizationId, orgId),
      ),
    )
    .orderBy(asc(userDatabases.name));

  const allowed: BaseInfo[] = [];
  for (const r of rows) if (await allows(r.spaceId, "editor")) allowed.push(r);
  const columnsByDb = await loadColumns(
    deps.executor,
    allowed.map((b) => b.databaseId),
  );

  return allowed.map((b) => {
    const columns = columnsByDb.get(b.databaseId) ?? [];
    const proposal = role ? automapRole(role, columns) : {};
    let score = 0;
    let status: CandidateStatus = "none";
    let missing: MissingColumn[] = [];
    if (role) {
      for (const def of CRM_FIELDS[role]) {
        const col = columns.find((c) => c.id === proposal[def.key]);
        // La cible d'une relation n'est connue qu'au raccordement : ici on exige seulement une cible.
        const state = validateField(def, proposal[def.key], columns, col?.targetDatabaseId ?? null);
        if (state.state === "ok") score++;
      }
      const label = opts.fieldLabel;
      ({ status, missing } = classifyCandidate(
        role,
        columns,
        proposal,
        opts.relationTargetKnown ?? false,
        label ? (key) => label(role, key) : undefined,
      ));
    }
    const compatible = status === "compatible";
    return { ...b, columns, proposal, score, compatible, status, missing };
  });
}

export type SaveConnectionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; code: "not_found" | "column_not_in_database" | "duplicate_database" };

export async function saveConnection(
  orgId: string,
  userId: string,
  input: { roles: Partial<Record<CrmRole, string | null>>; fieldMap: CrmFieldMap },
  deps: CrmDeps = defaultCrmDeps(),
): Promise<SaveConnectionResult> {
  const [existing] = await deps.executor
    .select()
    .from(crmConnections)
    .where(eq(crmConnections.organizationId, orgId))
    .limit(1);

  const effective: Partial<Record<CrmRole, string | null>> = {};
  for (const role of CRM_ROLES) {
    effective[role] = Object.prototype.hasOwnProperty.call(input.roles, role)
      ? (input.roles[role] ?? null)
      : (existing?.[ROLE_COLUMN[role]] ?? null);
  }

  const inputMap = parseFieldMap(input.fieldMap);
  const existingMap = parseFieldMap(existing?.fieldMap);
  const { resolveBase } = makeResolver(orgId, userId, deps);
  // Toute base fournie, ou conservée mais recevant des colonnes, est revérifiée `editor`
  // dans l'organisation de la requête (404 uniforme) AVANT tout contrôle de doublon.
  for (const role of CRM_ROLES) {
    const id = effective[role];
    if (!id) continue;
    const provided = !!input.roles[role];
    const receivesColumns = Object.values(inputMap[role] ?? {}).some((v) => !!v);
    if (!provided && !receivesColumns) continue;
    if (!(await resolveBase(id, "editor"))) return { ok: false, status: 404, code: "not_found" };
  }

  const chosen = CRM_ROLES.map((r) => effective[r]).filter((v): v is string => !!v);
  if (new Set(chosen).size !== chosen.length) {
    return { ok: false, status: 400, code: "duplicate_database" };
  }

  // Seules les colonnes reçues sont validées ; la correspondance d'un rôle absent du corps est conservée.
  for (const role of CRM_ROLES) {
    const ids = Object.values(inputMap[role] ?? {}).filter((v): v is string => !!v);
    if (ids.length === 0) continue;
    const base = effective[role];
    if (!base) return { ok: false, status: 400, code: "column_not_in_database" };
    const found = await deps.executor
      .select({ id: userDatabaseColumns.id })
      .from(userDatabaseColumns)
      .where(and(eq(userDatabaseColumns.databaseId, base), inArray(userDatabaseColumns.id, ids)));
    if (found.length !== new Set(ids).size) {
      return { ok: false, status: 400, code: "column_not_in_database" };
    }
  }

  // Fusion par rôle : un rôle absent garde sa correspondance ; elle n'est effacée que si le rôle
  // est dissocié ou change de base (sauf correspondance fournie explicitement).
  const fieldMap: CrmFieldMap = {};
  for (const role of CRM_ROLES) {
    const baseChanged =
      Object.prototype.hasOwnProperty.call(input.roles, role) &&
      (input.roles[role] ?? null) !== (existing?.[ROLE_COLUMN[role]] ?? null);
    if (Object.prototype.hasOwnProperty.call(inputMap, role)) fieldMap[role] = inputMap[role];
    else if (!baseChanged && existingMap[role]) fieldMap[role] = existingMap[role];
  }

  const now = new Date();
  const set: Partial<typeof crmConnections.$inferInsert> = { fieldMap, updatedBy: userId, updatedAt: now };
  const values: typeof crmConnections.$inferInsert = {
    organizationId: orgId,
    fieldMap,
    updatedBy: userId,
    updatedAt: now,
  };
  for (const role of CRM_ROLES) {
    if (Object.prototype.hasOwnProperty.call(input.roles, role)) {
      const v = input.roles[role] ?? null;
      set[ROLE_COLUMN[role]] = v;
      values[ROLE_COLUMN[role]] = v;
    }
  }
  await deps.executor
    .insert(crmConnections)
    .values(values)
    .onConflictDoUpdate({ target: crmConnections.organizationId, set });
  return { ok: true };
}

export async function hasConnectionRow(orgId: string, deps: CrmDeps = defaultCrmDeps()): Promise<boolean> {
  const [row] = await deps.executor
    .select({ id: crmConnections.organizationId })
    .from(crmConnections)
    .where(eq(crmConnections.organizationId, orgId))
    .limit(1);
  return !!row;
}
