/**
 * Fixture du lot 4 : etend celle du lot 3 avec user_database_views. `preMigrated: false` cree la
 * table sans colonne scope et avec l'ancien index unique (database_id, name), pour que le test de
 * la migration 0057 puisse echouer.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { setupRowTasksFixture } from "./row-tasks-fixture";

export function readViewScopeSql(): string {
  return readFileSync(join(process.cwd(), "src/lib/db/migrations/0057_view_scope.sql"), "utf8");
}

export async function setupViewsFixture(
  url: string,
  schemaName: string,
  opts: { preMigrated?: boolean } = {},
): Promise<Awaited<ReturnType<typeof setupRowTasksFixture>>> {
  const preMigrated = opts.preMigrated ?? true;
  const f = await setupRowTasksFixture(url, schemaName);
  await f.pool.query(`
    CREATE TABLE user_database_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      type text NOT NULL DEFAULT 'grid',
      config jsonb NOT NULL DEFAULT '{}',
      is_default boolean NOT NULL DEFAULT false,
      is_public boolean NOT NULL DEFAULT false,
      public_token varchar(64) UNIQUE,
      position integer NOT NULL DEFAULT 0,
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
  `);
  if (preMigrated) {
    await f.pool.query(readViewScopeSql());
  } else {
    await f.pool.query(
      "CREATE UNIQUE INDEX idx_user_database_views_unique_name ON user_database_views (database_id, name)",
    );
  }
  return f;
}
