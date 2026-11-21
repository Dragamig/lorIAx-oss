/**
 * Médiathèque : extension pg_trgm, exécutée AVANT `drizzle-kit push` (les index gin_trgm_ops de
 * media exigent l'extension). Idempotent. La copie attachments vers media (0052) est historique ;
 * le retrait des anciennes tables est fait par `retire-attachments.ts`.
 */
import { Pool } from "pg";

export async function ensureMediaExtensions(
  connectionString = process.env.DATABASE_URL
): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  ensureMediaExtensions()
    .catch((e) => {
      console.error("Erreur migrate-media :", e?.message ?? e);
      process.exit(1);
    });
}
