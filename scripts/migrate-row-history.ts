/**
 * Historique de ligne (lot 2) : fonctions et declencheurs de capture sur
 * user_database_rows (migration 0054). Tourne APRES `drizzle-kit push`, qui cree
 * la table database_row_changes. Idempotent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

export function readRowHistorySql(): string {
  return readFileSync(
    join(__dirname, "..", "src", "lib", "db", "migrations", "0054_row_history.sql"),
    "utf8"
  );
}

export async function ensureRowHistoryTriggers(
  connectionString = process.env.DATABASE_URL
): Promise<{ applied: true } | null> {
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    try {
      await client.query("SELECT 1 FROM user_database_rows LIMIT 0");
      await client.query("SELECT 1 FROM database_row_changes LIMIT 0");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/does not exist/i.test(msg)) return null;
      throw e;
    }

    await client.query("BEGIN");
    try {
      await client.query(readRowHistorySql());
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    console.log("✓ Historique de ligne : déclencheurs en place");
    return { applied: true };
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  ensureRowHistoryTriggers().catch((e) => {
    console.error("Erreur migrate-row-history :", e?.message ?? e);
    process.exit(1);
  });
}
