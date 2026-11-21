import { sql } from "drizzle-orm";
import type { DbExecutor } from "./row-writes";

/**
 * Supprime les vues personnelles d'un compte (a appeler dans la transaction de suppression du
 * compte, avant la reattribution des vues partagees : une vue personnelle reattribuee deviendrait
 * visible de l'admin).
 */
export async function deletePersonalViewsOf(executor: DbExecutor, userId: string): Promise<void> {
  await executor.execute(
    sql`DELETE FROM user_database_views WHERE created_by = ${userId} AND scope = 'personal'`,
  );
}
