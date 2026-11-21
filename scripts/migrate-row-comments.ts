/**
 * Commentaires et taches de ligne (lot 3, migration 0056). Tourne APRES `drizzle-kit push`, qui
 * cree deja tables, colonnes et index : ce script garantit la valeur d'enum `database_row`, la
 * contrainte `tasks_database_row_ctx` et l'equivalent idempotent du reste. Idempotent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

export function readRowCommentsSql(): string {
  return readFileSync(
    join(__dirname, "..", "src", "lib", "db", "migrations", "0056_row_comments_tasks.sql"),
    "utf8"
  );
}

/**
 * AVANT `drizzle-kit push` : le schema declare la contrainte `tasks_database_row_ctx` qui cite la
 * valeur d'enum `database_row`. Sans elle dans le type, le push peut echouer et bloquer le deploiement.
 * Hors transaction, saute si le type n'existe pas encore (base fraiche : le push le cree avec la valeur).
 */
export async function ensureTaskKindRowValue(
  connectionString = process.env.DATABASE_URL
): Promise<{ added: boolean }> {
  const pool = new Pool({ connectionString });
  try {
    const { rows } = await pool.query("SELECT to_regtype('task_kind') IS NOT NULL AS present");
    if (rows[0].present !== true) return { added: false };
    await pool.query("ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'database_row'");
    return { added: true };
  } finally {
    await pool.end();
  }
}

export async function ensureRowCommentsAndTasks(
  connectionString = process.env.DATABASE_URL
): Promise<{ applied: true } | null> {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    try {
      await client.query("SELECT 1 FROM tasks LIMIT 0");
      await client.query("SELECT 1 FROM notifications LIMIT 0");
      await client.query("SELECT 1 FROM user_databases LIMIT 0");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/does not exist/i.test(msg)) return null;
      throw e;
    }

    // Seul, hors transaction : la valeur doit etre validee avant d'etre referencee par la contrainte.
    await client.query("ALTER TYPE task_kind ADD VALUE IF NOT EXISTS 'database_row'");

    await client.query("BEGIN");
    try {
      await client.query(readRowCommentsSql());
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    console.log("✓ Commentaires et tâches de ligne : structure en place");
    return { applied: true };
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  ensureRowCommentsAndTasks().catch((e) => {
    console.error("Erreur migrate-row-comments :", e?.message ?? e);
    process.exit(1);
  });
}
