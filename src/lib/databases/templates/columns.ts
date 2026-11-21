import { eq, sql } from "drizzle-orm";
import { userDatabaseColumns } from "@/lib/db/schema";
import type { DbExecutor } from "../row-writes";
import { normalizeOptions } from "@/components/editor/extensions/database-block/options";
import type { TemplateColumn } from "./types";

/** Nom comparable : sans accents, minuscules, bords rognés, espaces internes réduits. */
export function normalizeTemplateName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Insère les colonnes à la suite des existantes ; rend les ids par `key`. */
export async function insertColumns(
  tx: DbExecutor,
  databaseId: string,
  columns: TemplateColumn[],
): Promise<Record<string, string>> {
  // Les relations passent seulement par pairRelation : jamais de colonne relation ni de lien posé à la main.
  if (columns.some((c) => c.type === "relation")) {
    throw new Error("insertColumns: relation columns must be created with pairRelation");
  }
  const [{ max }] = await tx
    .select({ max: sql<number | null>`max(${userDatabaseColumns.position})` })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId));
  let position = max === null || max === undefined ? 0 : Number(max) + 1;
  const ids: Record<string, string> = {};
  for (const col of columns) {
    const config: Record<string, unknown> = { ...(col.config ?? {}) };
    delete config.targetDatabaseId;
    delete config.inverseColumnId;
    if (col.options) config.options = normalizeOptions(col.options);
    const [row] = await tx
      .insert(userDatabaseColumns)
      .values({ databaseId, name: col.name, type: col.type, position: position++, config })
      .returning({ id: userDatabaseColumns.id });
    ids[col.key] = row.id;
  }
  return ids;
}

/** Noms des colonnes déjà présentes dans la base (lecture seule). */
export async function listColumnNames(tx: DbExecutor, databaseId: string): Promise<string[]> {
  const rows = await tx
    .select({ name: userDatabaseColumns.name })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId));
  return rows.map((r) => r.name);
}
