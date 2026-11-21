import { eq, sql } from "drizzle-orm";
import logger from "@/lib/logger";
import { spaces } from "@/lib/db/schema";
import { crmConnections } from "@/lib/db/schema-crm";
import { applyTemplate, completeDatabase } from "@/lib/databases/templates/apply";
import { requireEditableDatabase } from "@/lib/databases/templates/access";
import { normalizeTemplateName } from "@/lib/databases/templates/columns";
import { pairRelation } from "@/lib/databases/templates/relations";
import {
  TemplateFailure,
  type AppliedTemplate,
  type TemplateContext,
} from "@/lib/databases/templates/types";
import { afterSpaceCreated, assertSpaceQuota } from "@/lib/spaces/create-space";
import type { PermissionLevel } from "@/types";
import { automapRole } from "./automap";
import { defaultCrmDeps, loadColumns, saveConnection, type CrmDeps } from "./connection";
import { CRM_FIELDS, CRM_ROLES, parseFieldMap, type CrmActivateBodyV2, type CrmFieldMap, type CrmRole } from "./fields";
import { fallbackColumnName, normalizeName, planMissing } from "./plan";
import { buildRoleDatabase, crmRelations, missingToTemplateColumns } from "./template";
import { loadTemplateMessages } from "./template-messages";
import { validateField } from "./validate";

const ROLE_COLUMN_OF = {
  contacts: "contactsDatabaseId",
  dossiers: "dealsDatabaseId",
  interactions: "interactionsDatabaseId",
} as const satisfies Record<CrmRole, string>;

export type ActivationBindings = Partial<
  Record<CrmRole, { databaseId: string; fieldMap?: Record<string, string | null | undefined> }>
>;

export type ActivateFailure =
  | { ok: false; status: 404; code: "not_found" }
  | { ok: false; status: 403; code: "forbidden" }
  | { ok: false; status: 409; code: "name_collision"; role: CrmRole }
  | { ok: false; status: 400; code: "column_not_in_database" | "duplicate_database" | "space_quota" };

export type ActivateResult =
  | { ok: true; reactivated: boolean; created: CrmRole[]; completed: CrmRole[]; unlinkedRelations: string[] }
  | ActivateFailure;

export interface ActivateInput {
  /** Corps historique : équivaut à des rôles en mode `connect`. */
  bindings?: ActivationBindings;
  v2?: CrmActivateBodyV2;
  locale: string;
}

type RolePlan =
  | { mode: "connect"; databaseId: string; fieldMap?: Record<string, string | null | undefined> }
  | { mode: "complete"; databaseId: string }
  | { mode: "create" };

type FieldIds = Record<string, string | null>;

/** Abandon de la transaction avec un résultat métier : l'exception déclenche le rollback. */
class ActivationAbort extends Error {
  constructor(public readonly result: ActivateFailure) {
    super(`activation_${result.code}`);
  }
}

/**
 * Traduit un refus du générateur. Une collision sur la clé `inverse` (colonne jumelle) n'est imputable à aucun rôle :
 * freeName l'évite, elle ne peut venir que d'une concurrence ou d'un défaut, donc erreur 500 journalisée par l'appelant.
 */
function failureOf(e: TemplateFailure, role: CrmRole | null): ActivateFailure {
  const err = e.error;
  switch (err.code) {
    case "not_found":
      return { ok: false, status: 404, code: "not_found" };
    case "forbidden":
      return { ok: false, status: 403, code: "forbidden" };
    case "name_collision": {
      if (err.key === "inverse") throw e;
      const named = (CRM_ROLES as readonly string[]).includes(err.key) ? (err.key as CrmRole) : role;
      if (!named) throw e;
      return { ok: false, status: 409, code: "name_collision", role: named };
    }
    case "relation_conflict":
      throw e;
    default: {
      const unknown: never = err;
      void unknown;
      throw e;
    }
  }
}

/** `wanted`, puis `wanted 2`, `wanted 3`, jusqu'à un nom absent de `taken`. */
function freeName(wanted: string, taken: readonly string[]): string {
  const used = new Set(taken.map(normalizeName));
  if (!used.has(normalizeName(wanted))) return wanted;
  for (let n = 2; ; n++) {
    const candidate = `${wanted} ${n}`;
    if (!used.has(normalizeName(candidate))) return candidate;
  }
}

function rolePlans(input: ActivateInput): Partial<Record<CrmRole, RolePlan>> {
  const out: Partial<Record<CrmRole, RolePlan>> = {};
  if (input.v2) {
    for (const role of CRM_ROLES) {
      const r = input.v2.roles[role];
      if (r) out[role] = r;
    }
  } else if (input.bindings) {
    for (const role of CRM_ROLES) {
      const b = input.bindings[role];
      if (b) out[role] = { mode: "connect", databaseId: b.databaseId, fieldMap: b.fieldMap };
    }
  }
  return out;
}

/**
 * Active le CRM de l'organisation. Une seule transaction sous verrou consultatif : espace, bases créées,
 * colonnes ajoutées, relations jumelées, correspondance de colonnes, raccordement. Un échec annule tout.
 * Aucune écriture dans les Bases ici : tout passe par le générateur neutre `lib/databases/templates`.
 */
export async function activateCrm(
  orgId: string,
  userId: string,
  input: ActivateInput,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<ActivateResult> {
  const plans = rolePlans(input);
  const given = CRM_ROLES.filter((r) => !!plans[r]);

  const ids = given.flatMap((r) => {
    const p = plans[r]!;
    return p.mode === "create" ? [] : [p.databaseId];
  });
  if (new Set(ids).size !== ids.length) return { ok: false, status: 400, code: "duplicate_database" };

  let currentRole: CrmRole | null = null;
  let createdSpaceId: string | null = null;
  try {
    const result = await deps.executor.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`crm_activate:${orgId}`}, 0))`);
      const [existing] = await tx
        .select()
        .from(crmConnections)
        .where(eq(crmConnections.organizationId, orgId))
        .limit(1);

      const created: CrmRole[] = [];
      const completed: CrmRole[] = [];
      const unlinked: string[] = [];
      const createdIds: string[] = [];
      const dbIdOf: Partial<Record<CrmRole, string>> = {};
      const fm: Partial<Record<CrmRole, FieldIds>> = {};
      const dirty = new Set<CrmRole>();

      if (given.length > 0) {
        const m = await loadTemplateMessages(input.locale);
        // Un utilisateur est propriétaire de l'espace qu'il crée : la permission n'est pas relisible
        // hors transaction tant que l'espace n'est pas validé.
        const permissionOf = async (u: string, s: string): Promise<PermissionLevel | null> =>
          s === createdSpaceId ? "admin" : deps.permissionOf(u, s);
        const ctx: TemplateContext = { orgId, userId, permissionOf };
        const txDeps: CrmDeps = { ...deps, executor: tx, permissionOf };

        const createRoles = given.filter((r) => plans[r]!.mode === "create");
        const completeRoles = given.filter((r) => plans[r]!.mode === "complete");
        const space = input.v2?.space;

        const names = createRoles.map((r) => normalizeName(m.databases[r]));
        if (new Set(names).size !== names.length) throw new ActivationAbort({ ok: false, status: 400, code: "duplicate_database" });

        // Toute base fournie (connect comme complete) est confrontée à l'organisation et à la permission
        // avant la moindre lecture de ses colonnes.
        for (const role of given) {
          const p = plans[role]!;
          if (p.mode === "create") continue;
          currentRole = role;
          await requireEditableDatabase(tx, ctx, p.databaseId);
        }

        let applied: AppliedTemplate | null = null;
        const createsSpace = createRoles.length > 0 && space?.mode === "create";
        if (createsSpace) {
          const quota = await assertSpaceQuota(orgId);
          if (quota.exceeded) throw new ActivationAbort({ ok: false, status: 400, code: "space_quota" });
          // Rejeu après désactivation : l'espace créé la première fois existe encore, pas de second espace.
          const wanted = normalizeTemplateName(m.space);
          const sameName = (
            await tx.select({ name: spaces.name }).from(spaces).where(eq(spaces.organizationId, orgId))
          ).some((sp) => normalizeTemplateName(sp.name) === wanted);
          if (sameName) {
            throw new ActivationAbort({ ok: false, status: 409, code: "name_collision", role: createRoles[0] });
          }
        }
        if (space && (createRoles.length > 0 || space.mode === "existing")) {
          currentRole = null;
          applied = await applyTemplate(tx, ctx, {
            space: space.mode === "create" ? { mode: "create", name: m.space } : { mode: "existing", spaceId: space.spaceId },
            databases: createRoles.map((r) => buildRoleDatabase(r, m)),
          });
          if (applied.spaceCreated) createdSpaceId = applied.spaceId;
        }

        for (const role of given) {
          const p = plans[role]!;
          if (p.mode === "create") {
            const made = applied!.databases[role];
            dbIdOf[role] = made.id;
            fm[role] = { ...made.columns };
            created.push(role);
            createdIds.push(made.id);
          } else {
            dbIdOf[role] = p.databaseId;
          }
        }

        const targetCache = new Map<CrmRole, string | null>();
        const targetOf = async (role: CrmRole): Promise<string | null> => {
          if (dbIdOf[role]) return dbIdOf[role]!;
          if (targetCache.has(role)) return targetCache.get(role)!;
          const saved = existing?.[ROLE_COLUMN_OF[role]] ?? null;
          let ok: string | null = null;
          if (saved) {
            try {
              await requireEditableDatabase(tx, ctx, saved);
              ok = saved;
            } catch (e) {
              if (!(e instanceof TemplateFailure)) throw e;
            }
          }
          targetCache.set(role, ok);
          return ok;
        };
        const relationTarget = async (role: CrmRole) => {
          const def = CRM_FIELDS[role].find((f) => f.relationTargetRole);
          return def?.relationTargetRole ? targetOf(def.relationTargetRole) : null;
        };
        const label = (role: CrmRole, key: string) => m.fields[role][key];

        // Colonnes simples des bases à compléter, sur l'état réel de la base à cet instant.
        const existingMap = parseFieldMap(existing?.fieldMap);
        for (const role of completeRoles) {
          currentRole = role;
          const databaseId = dbIdOf[role]!;
          const columns = (await loadColumns(tx, [databaseId])).get(databaseId) ?? [];
          const auto = automapRole(role, columns);
          const missing = planMissing(role, columns, auto, {
            fieldLabel: (k) => label(role, k),
            relationTargetKnown: (await relationTarget(role)) !== null,
          }).filter((x) => x.type !== "relation");
          const added = missing.length
            ? await completeDatabase(tx, ctx, { databaseId, columns: missingToTemplateColumns(missing, role, m) })
            : {};
          fm[role] = { ...auto, ...added };
          completed.push(role);
        }
        for (const role of given) {
          const p = plans[role]!;
          if (p.mode !== "connect") continue;
          const sameBase = !!existing && existing[ROLE_COLUMN_OF[role]] === p.databaseId;
          if (p.fieldMap) fm[role] = { ...(p.fieldMap as FieldIds) };
          else if (sameBase) fm[role] = { ...(existingMap[role] ?? {}) };
          else {
            const columns = (await loadColumns(tx, [p.databaseId])).get(p.databaseId) ?? [];
            fm[role] = automapRole(role, columns);
          }
          if (p.fieldMap || !sameBase) dirty.add(role);
        }

        // Relations jumelées : seulement vers une base présente dans l'activation ou déjà raccordée.
        const specs = crmRelations(m);
        for (const role of given) {
          currentRole = role;
          const databaseId = dbIdOf[role]!;
          const mode = plans[role]!.mode;
          for (const def of CRM_FIELDS[role]) {
            if (!def.relationTargetRole) continue;
            const targetDb = await targetOf(def.relationTargetRole);
            const columns = mode === "create" ? [] : ((await loadColumns(tx, [databaseId])).get(databaseId) ?? []);
            const current = fm[role]![def.key] ?? null;
            const col = columns.find((c) => c.id === current);
            const state = validateField(def, current, columns, targetDb);
            const spec = specs.find((s) => s.from === role && s.fieldKey === def.key);
            if (!spec || targetDb === null || targetDb === databaseId) {
              if (state.state !== "ok") unlinked.push(label(role, def.key));
              continue;
            }
            if (state.state === "ok" && mode === "create") continue;
            let columnId: string | undefined;
            let name = label(role, def.key);
            if (state.state === "ok") columnId = col!.id;
            else if (mode !== "create") {
              const plan = planMissing(role, columns, fm[role]!, { fieldLabel: (k) => label(role, k), relationTargetKnown: true });
              name = plan.find((x) => x.fieldKey === def.key)?.name ?? fallbackColumnName(name, "relation", columns.map((c) => c.name));
            }
            const targetNames = ((await loadColumns(tx, [targetDb])).get(targetDb) ?? []).map((c) => c.name);
            try {
              const paired = await pairRelation(tx, ctx, {
                databaseId,
                columnId,
                name,
                targetDatabaseId: targetDb,
                inverseName: freeName(spec.inverseName, targetNames),
              });
              if (state.state !== "ok") {
                fm[role]![def.key] = paired.columnId;
                dirty.add(role);
              }
            } catch (e) {
              if (e instanceof TemplateFailure && e.error.code === "relation_conflict") {
                if (state.state !== "ok") unlinked.push(label(role, def.key));
                continue;
              }
              throw e;
            }
          }
        }
        currentRole = null;

        const roles: Partial<Record<CrmRole, string | null>> = {};
        const fieldMap: CrmFieldMap = {};
        for (const role of given) {
          roles[role] = dbIdOf[role]!;
          if (plans[role]!.mode !== "connect" || dirty.has(role)) fieldMap[role] = fm[role]!;
        }
        const saved = await saveConnection(orgId, userId, { roles, fieldMap }, txDeps);
        if (!saved.ok) {
          throw new ActivationAbort(
            saved.status === 404
              ? { ok: false, status: 404, code: "not_found" }
              : { ok: false, status: 400, code: saved.code as "column_not_in_database" | "duplicate_database" },
          );
        }
      }

      const now = new Date();
      const createdAll = createdIds.length > 0 ? [...new Set([...(existing?.createdDatabaseIds ?? []), ...createdIds])] : null;
      await tx
        .insert(crmConnections)
        .values({
          organizationId: orgId,
          enabled: true,
          updatedBy: userId,
          updatedAt: now,
          ...(createdAll ? { createdDatabaseIds: createdAll } : {}),
        })
        .onConflictDoUpdate({
          target: crmConnections.organizationId,
          set: { enabled: true, updatedBy: userId, updatedAt: now, ...(createdAll ? { createdDatabaseIds: createdAll } : {}) },
        });
      return {
        ok: true as const,
        reactivated: !!existing && given.length === 0,
        created,
        completed,
        unlinkedRelations: unlinked,
      };
    });

    if (createdSpaceId) {
      try {
        const [space] = await deps.executor.select().from(spaces).where(eq(spaces.id, createdSpaceId)).limit(1);
        const sideEffects = space ? await afterSpaceCreated(space, userId) : { gitOk: true };
        if (!sideEffects.gitOk) {
          logger.warn({ spaceId: createdSpaceId }, "[crm] activation : dépôt Git de l'espace non initialisé");
        }
      } catch (err) {
        // Effets de bord secondaires : l'activation est déjà validée.
        logger.error({ err, spaceId: createdSpaceId }, "[crm] activation : effets secondaires de la création d'espace en échec");
      }
    }
    return result;
  } catch (e) {
    if (e instanceof ActivationAbort) return e.result;
    if (e instanceof TemplateFailure) {
      try {
        return failureOf(e, currentRole);
      } catch (unhandled) {
        logger.error({ err: unhandled, role: currentRole }, "[crm] activation : refus du générateur sans issue métier");
        throw unhandled;
      }
    }
    throw e;
  }
}

/** Désactive sans rien perdre : bases, rôles et correspondance de colonnes restent. */
export async function deactivateCrm(
  orgId: string,
  userId: string,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<void> {
  await deps.executor
    .update(crmConnections)
    .set({ enabled: false, updatedBy: userId, updatedAt: new Date() })
    .where(eq(crmConnections.organizationId, orgId));
}

