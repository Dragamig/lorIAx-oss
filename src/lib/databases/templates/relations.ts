import { and, eq, sql } from "drizzle-orm";
import { userDatabaseColumns } from "@/lib/db/schema";
import {
  RelationColumnError,
  createPairedRelationColumn,
  findPairedInverse,
} from "../relation-columns";
import type { DbExecutor } from "../row-writes";
import { requireEditableDatabase } from "./access";
import { normalizeTemplateName } from "./columns";
import { TemplateFailure, type TemplateContext } from "./types";

export interface RelationSpec {
  databaseId: string;
  /** Présent si la colonne relation existe déjà d'un seul côté. */
  columnId?: string;
  name: string;
  targetDatabaseId: string;
  inverseName: string;
}

export interface PairedRelation {
  columnId: string;
  inverseColumnId: string;
  created: "both" | "inverse-only" | "none";
}

type Cfg = Record<string, unknown>;

/**
 * Pose une relation jumelée entre deux bases (ou seulement l'inverse d'une relation existante).
 * Organisation et droit editor vérifiés sur les DEUX bases avant toute écriture.
 * Lève TemplateFailure ; l'appelant annule sa transaction.
 */
export async function pairRelation(
  tx: DbExecutor,
  ctx: TemplateContext,
  spec: RelationSpec,
): Promise<PairedRelation> {
  if (spec.databaseId === spec.targetDatabaseId) {
    throw new TemplateFailure({ code: "relation_conflict" });
  }
  await requireEditableDatabase(tx, ctx, spec.databaseId);
  await requireEditableDatabase(tx, ctx, spec.targetDatabaseId);

  try {
    if (!spec.columnId) {
      const { column, inverse } = await createPairedRelationColumn(tx, {
        databaseId: spec.databaseId,
        targetDatabaseId: spec.targetDatabaseId,
        name: spec.name,
        inverseName: spec.inverseName,
      });
      return { columnId: column.id, inverseColumnId: inverse.id, created: "both" };
    }
    return await completePair(tx, spec, spec.columnId);
  } catch (e) {
    if (e instanceof RelationColumnError) {
      throw new TemplateFailure({ code: "name_collision", key: "inverse" });
    }
    throw e;
  }
}

async function completePair(
  tx: DbExecutor,
  spec: RelationSpec,
  columnId: string,
): Promise<PairedRelation> {
  // Mêmes verrous de base que createPairedRelationColumn, ordre déterministe.
  for (const id of [...new Set([spec.databaseId, spec.targetDatabaseId])].sort()) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`);
  }
  const [column] = await tx
    .select()
    .from(userDatabaseColumns)
    .where(
      and(
        eq(userDatabaseColumns.id, columnId),
        eq(userDatabaseColumns.databaseId, spec.databaseId),
        eq(userDatabaseColumns.type, "relation"),
      ),
    )
    .limit(1);
  if (!column) throw new TemplateFailure({ code: "not_found" });
  const cfg = (column.config as Cfg | null) ?? {};
  if (cfg.targetDatabaseId !== spec.targetDatabaseId) {
    throw new TemplateFailure({ code: "relation_conflict" });
  }

  const paired = await findPairedInverse(tx, column);
  if (paired) return { columnId: column.id, inverseColumnId: paired.id, created: "none" };
  // Lien présent mais non réciproque : jamais écrasé.
  if (cfg.inverseColumnId !== undefined && cfg.inverseColumnId !== null) {
    throw new TemplateFailure({ code: "relation_conflict" });
  }

  const wanted = normalizeTemplateName(spec.inverseName);
  const names = await tx
    .select({ name: userDatabaseColumns.name })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, spec.targetDatabaseId));
  if (names.some((c) => normalizeTemplateName(c.name) === wanted)) {
    throw new TemplateFailure({ code: "name_collision", key: "inverse" });
  }

  const [{ max }] = await tx
    .select({ max: sql<number | null>`max(${userDatabaseColumns.position})` })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, spec.targetDatabaseId));
  const [inverse] = await tx
    .insert(userDatabaseColumns)
    .values({
      databaseId: spec.targetDatabaseId,
      name: spec.inverseName,
      type: "relation",
      config: { targetDatabaseId: spec.databaseId, inverseColumnId: column.id },
      position: max === null || max === undefined ? 0 : Number(max) + 1,
    })
    .returning({ id: userDatabaseColumns.id });

  // Fusion jsonb de la seule clé inverseColumnId : le reste de la colonne n'est pas touché.
  await tx
    .update(userDatabaseColumns)
    .set({
      config: sql`COALESCE(${userDatabaseColumns.config}, '{}'::jsonb) || jsonb_build_object('inverseColumnId', ${inverse.id}::text)`,
    })
    .where(eq(userDatabaseColumns.id, column.id));

  return { columnId: column.id, inverseColumnId: inverse.id, created: "inverse-only" };
}
