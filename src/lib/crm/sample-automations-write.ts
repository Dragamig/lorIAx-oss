/**
 * Insertion idempotente des automatismes d'exemple de la base Dossiers, dans la transaction d'activation.
 *
 * `crm_connections.created_automation_keys` fait foi : une clé déjà présente n'est jamais recréée, même si
 * l'utilisateur a supprimé l'automatisme. Les exemples sont créés désactivés. Les options de Statut
 * manquantes sont ajoutées à la colonne Statut (sans rien renommer ni retirer).
 */
import { and, eq } from "drizzle-orm";
import { normalizeOptions } from "@/components/editor/extensions/database-block/options";
import { sanitizeWebhookTriggerConfig } from "@/lib/automations/webhook-inbound";
import { requireEditableDatabase } from "@/lib/databases/templates/access";
import { appendSelectOptions, insertDisabledAutomations } from "@/lib/databases/templates/automations";
import { TemplateFailure, type TemplateContext } from "@/lib/databases/templates/types";
import type { DbExecutor } from "@/lib/databases/row-writes";
import { userDatabaseColumns } from "@/lib/db/schema";
import { crmConnections } from "@/lib/db/schema-crm";
import { loadColumns } from "./connection";
import { CRM_FIELDS, CRM_ROLES, parseFieldMap, type CrmRole } from "./fields";
import {
  buildSampleAutomations,
  SAMPLE_AUTOMATION_KEYS,
  statusOptionsToAdd,
  type SampleAutomation,
  type SkippedSample,
  type SampleAutomationMessages,
  type SampleRelationKey,
} from "./sample-automations";
import { validateField } from "./validate";

export interface SampleWriteResult {
  /** Clés créées par ce passage. */
  created: string[];
  /** Clés non créées (prérequis manquants) : réessayées à la prochaine activation. */
  skipped: string[];
  /** Libellés ajoutés à la colonne Statut. */
  statusOptionsAdded: string[];
  /** Clés mémorisées après ce passage (anciennes + créées). */
  keys: string[];
}

async function usableDatabase(tx: DbExecutor, ctx: TemplateContext, id: string | null | undefined) {
  if (!id) return null;
  try {
    await requireEditableDatabase(tx, ctx, id);
    return id;
  } catch (e) {
    if (e instanceof TemplateFailure) return null;
    throw e;
  }
}

export interface SampleAutomationsPlan {
  /** Clés déjà mémorisées dans le raccordement. */
  known: string[];
  /** Exemples à créer : prérequis satisfaits et clé inconnue. */
  todo: SampleAutomation[];
  /** Exemples non créables (prérequis manquants) et clé inconnue. */
  skipped: SkippedSample[];
  /** Base Dossiers utilisable, colonne Statut et ses options (null si absente ou non select). */
  dossiersDatabaseId: string | null;
  statusColumnId: string | null;
  existingStatusOptions: string[] | null;
  /** Options de Statut à ajouter pour les seuls exemples de `todo`. */
  statusOptionsToAdd: string[];
}

/**
 * Calcul en lecture seule : quels exemples créer, lesquels sauter, quelles options de Statut ajouter.
 * Seule source de la règle, partagée par l'insertion (dans la transaction d'activation) et l'aperçu.
 */
export async function planSampleAutomations(
  tx: DbExecutor,
  ctx: TemplateContext,
  orgId: string,
  m: SampleAutomationMessages,
): Promise<SampleAutomationsPlan> {
  const [conn] = await tx.select().from(crmConnections).where(eq(crmConnections.organizationId, orgId)).limit(1);
  const known = new Set<string>(Array.isArray(conn?.createdAutomationKeys) ? conn.createdAutomationKeys : []);
  const empty: SampleAutomationsPlan = {
    known: [...known],
    todo: [],
    skipped: [],
    dossiersDatabaseId: null,
    statusColumnId: null,
    existingStatusOptions: null,
    statusOptionsToAdd: [],
  };
  if (known.size >= SAMPLE_AUTOMATION_KEYS.length) return empty;

  const roleDb = {
    contacts: await usableDatabase(tx, ctx, conn?.contactsDatabaseId),
    dossiers: await usableDatabase(tx, ctx, conn?.dealsDatabaseId),
    interactions: await usableDatabase(tx, ctx, conn?.interactionsDatabaseId),
  } as Record<CrmRole, string | null>;

  const map = parseFieldMap(conn?.fieldMap);
  const columnsByDb = await loadColumns(tx, CRM_ROLES.flatMap((r) => (roleDb[r] ? [roleDb[r]!] : [])));
  const fieldIds: Partial<Record<CrmRole, Record<string, string | null>>> = {};
  for (const role of CRM_ROLES) {
    const db = roleDb[role];
    if (!db) continue;
    const columns = columnsByDb.get(db) ?? [];
    const ids: Record<string, string | null> = {};
    for (const def of CRM_FIELDS[role]) {
      const id = map[role]?.[def.key] ?? null;
      const target = def.relationTargetRole ? roleDb[def.relationTargetRole] : undefined;
      ids[def.key] = validateField(def, id, columns, target).state === "ok" ? id : null;
    }
    fieldIds[role] = ids;
  }
  const relationIds: Partial<Record<SampleRelationKey, string | null>> = {
    dossiersContact: fieldIds.dossiers?.contact,
    interactionsDossier: fieldIds.interactions?.dossier,
    interactionsContact: fieldIds.interactions?.contact,
  };

  // Options de Statut : lues seulement quand la colonne est un select utilisable.
  const statutId = fieldIds.dossiers?.statut ?? null;
  let existingStatusOptions: string[] | null = null;
  if (statutId && roleDb.dossiers) {
    const [col] = await tx
      .select({ type: userDatabaseColumns.type, config: userDatabaseColumns.config })
      .from(userDatabaseColumns)
      .where(and(eq(userDatabaseColumns.id, statutId), eq(userDatabaseColumns.databaseId, roleDb.dossiers)))
      .limit(1);
    if (col?.type === "select") {
      const cfg = (col.config ?? {}) as Record<string, unknown>;
      existingStatusOptions = normalizeOptions(cfg.options);
    }
  }

  const built = buildSampleAutomations({ roleDb, fieldIds, relationIds, existingStatusOptions }, m);
  const todo = built.automations.filter((a) => !known.has(a.key));
  const skipped = built.skipped.filter((s) => !known.has(s.key));

  return {
    known: [...known],
    todo,
    skipped,
    dossiersDatabaseId: roleDb.dossiers,
    statusColumnId: statutId,
    existingStatusOptions,
    statusOptionsToAdd: statusOptionsToAdd(todo, existingStatusOptions),
  };
}

/** Crée les exemples manquants. Lit le raccordement tel qu'il vient d'être écrit dans la transaction. */
export async function insertSampleAutomations(
  tx: DbExecutor,
  ctx: TemplateContext,
  orgId: string,
  m: SampleAutomationMessages,
): Promise<SampleWriteResult> {
  const plan = await planSampleAutomations(tx, ctx, orgId, m);
  const { todo, known } = plan;
  const created = todo.map((s) => s.key as string);
  if (todo.length > 0) await insertDisabledAutomations(
    tx,
    plan.dossiersDatabaseId!,
    ctx.userId,
    todo.map((sample) => ({
      name: sample.name,
      triggerType: sample.triggerType,
      triggerConfig: {
        ...(sample.triggerType === "webhook_inbound"
          ? sanitizeWebhookTriggerConfig(sample.triggerConfig)
          : sample.triggerConfig),
        crmSample: sample.key,
      },
      actionType: sample.actionType,
      actionConfig: sample.actionConfig,
      graph: sample.graph,
    })),
  );

  // Options nécessaires aux seuls exemples créés dans ce passage, ajoutées une fois.
  const statusOptionsAdded: string[] = [];
  if (plan.statusOptionsToAdd.length > 0 && plan.statusColumnId) {
    await appendSelectOptions(tx, plan.dossiersDatabaseId!, plan.statusColumnId, plan.statusOptionsToAdd);
    statusOptionsAdded.push(...plan.statusOptionsToAdd);
  }

  return { created, skipped: plan.skipped.map((x) => x.key), statusOptionsAdded, keys: [...known, ...created] };
}
