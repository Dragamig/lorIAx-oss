import { and, eq, isNull, sql } from "drizzle-orm";
import { spaces, userDatabases } from "@/lib/db/schema";
import { insertSpace } from "@/lib/spaces/create-space";
import type { DbExecutor } from "../row-writes";
import { requireEditableDatabase } from "./access";
import { insertViews } from "./views";
import { insertColumns, listColumnNames, normalizeTemplateName } from "./columns";
import {
  TemplateFailure,
  type AppliedTemplate,
  type TemplateColumn,
  type TemplateContext,
  type TemplateSpec,
} from "./types";

export type { TemplateContext };

/**
 * Crée l'espace éventuel, les bases et leurs colonnes dans la transaction fournie.
 * Lève TemplateFailure ; l'appelant annule sa transaction. afterSpaceCreated reste à lancer après commit.
 */
export async function applyTemplate(
  tx: DbExecutor,
  ctx: TemplateContext,
  spec: TemplateSpec,
): Promise<AppliedTemplate> {
  let spaceId: string;
  let spaceCreated = false;
  let taken = new Set<string>();

  if (spec.space.mode === "existing") {
    spaceId = spec.space.spaceId;
    const [space] = await tx
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.organizationId, ctx.orgId)))
      .limit(1);
    if (!space) throw new TemplateFailure({ code: "not_found" });
    const level = await ctx.permissionOf(ctx.userId, spaceId);
    if (level !== "editor" && level !== "admin") throw new TemplateFailure({ code: "forbidden" });
    const existing = await tx
      .select({ name: userDatabases.name })
      .from(userDatabases)
      .where(
        and(
          eq(userDatabases.spaceId, spaceId),
          isNull(userDatabases.archivedAt),
          isNull(userDatabases.deletedAt),
        ),
      );
    taken = new Set(existing.map((d) => normalizeTemplateName(d.name)));
  } else {
    // Appelant administrateur de l'organisation : espace partagé dont l'utilisateur est propriétaire.
    const space = await insertSpace(tx, {
      orgId: ctx.orgId,
      userId: ctx.userId,
      name: spec.space.name,
      type: "organization",
    });
    spaceId = space.id;
    spaceCreated = true;
  }

  const databases: AppliedTemplate["databases"] = {};
  const [{ max }] = await tx
    .select({ max: sql<number | null>`max(${userDatabases.position})` })
    .from(userDatabases)
    .where(eq(userDatabases.spaceId, spaceId));
  let position = max === null || max === undefined ? 0 : Number(max) + 1;
  for (const db of spec.databases) {
    const norm = normalizeTemplateName(db.name);
    if (taken.has(norm)) throw new TemplateFailure({ code: "name_collision", key: db.key });
    taken.add(norm);
    const [row] = await tx
      .insert(userDatabases)
      .values({ spaceId, name: db.name, position: position++, createdBy: ctx.userId })
      .returning({ id: userDatabases.id });
    const columns = await insertColumns(tx, row.id, db.columns);
    if (db.views?.length) await insertViews(tx, row.id, ctx.userId, db.key, db.views, columns);
    databases[db.key] = { id: row.id, columns };
  }
  return { spaceId, spaceCreated, databases };
}

export interface CompleteSpec {
  databaseId: string;
  columns: TemplateColumn[];
}

/**
 * Ajoute des colonnes à une base existante : insertions uniquement, jamais d'update ni de delete.
 * Organisation confrontée avant toute permission ; rend les ids ajoutés par `key`.
 */
export async function completeDatabase(
  tx: DbExecutor,
  ctx: TemplateContext,
  spec: CompleteSpec,
): Promise<Record<string, string>> {
  await requireEditableDatabase(tx, ctx, spec.databaseId);

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${spec.databaseId}, 0))`);

  const taken = new Set((await listColumnNames(tx, spec.databaseId)).map(normalizeTemplateName));
  for (const col of spec.columns) {
    const norm = normalizeTemplateName(col.name);
    if (taken.has(norm)) throw new TemplateFailure({ code: "name_collision", key: col.key });
    taken.add(norm);
  }
  return insertColumns(tx, spec.databaseId, spec.columns);
}
