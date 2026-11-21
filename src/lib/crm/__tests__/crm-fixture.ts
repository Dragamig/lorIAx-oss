/**
 * Fixture d'integration du module CRM : etend celle de l'historique de ligne avec les tables
 * organisations, les colonnes de nom et d'archivage des bases, puis applique la migration 0060.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupRowHistoryFixture } from "@/lib/databases/__tests__/row-history-fixture";

export const CRM_MIGRATION_PATH = join(
  process.cwd(),
  "src/lib/db/migrations/0060_crm_connections.sql",
);

export async function setupCrmFixture(url: string, schemaName: string) {
  const fixture = await setupRowHistoryFixture(url, schemaName);
  await fixture.pool.query(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug varchar(100) NOT NULL DEFAULT '',
      name varchar(255) NOT NULL DEFAULT '');
    ALTER TABLE spaces ADD COLUMN name varchar(255) NOT NULL DEFAULT '';
    ALTER TABLE user_databases
      ADD COLUMN name varchar(255) NOT NULL DEFAULT '',
      ADD COLUMN archived_at timestamptz,
      ADD COLUMN deleted_at timestamptz;
  `);
  await fixture.pool.query(readFileSync(CRM_MIGRATION_PATH, "utf8"));
  return fixture;
}

export type SeedColumn = { name: string; type: string; config?: Record<string, unknown> };

/**
 * Fixture d'activation : etend celle du CRM avec les vues, les permissions d'espace, le proprietaire
 * d'espace, et des helpers de semis (organisation, espace, base avec colonnes ordonnees).
 */
export async function setupActivationFixture(url: string, schemaName: string) {
  const fixture = await setupCrmFixture(url, schemaName);
  await fixture.pool.query(`
    ALTER TABLE spaces ADD COLUMN IF NOT EXISTS organization_id uuid;
    ALTER TABLE spaces ADD COLUMN IF NOT EXISTS owner_user_id uuid;
    ALTER TABLE user_database_columns ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}';
    ALTER TABLE user_database_columns ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS user_database_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      type text NOT NULL DEFAULT 'grid',
      config jsonb NOT NULL DEFAULT '{}',
      is_default boolean NOT NULL DEFAULT false,
      is_public boolean NOT NULL DEFAULT false,
      public_token varchar(64) UNIQUE,
      position integer NOT NULL DEFAULT 0,
      scope varchar(16) NOT NULL DEFAULT 'shared',
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS space_permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      user_id uuid, team_id uuid,
      level text NOT NULL DEFAULT 'viewer',
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  const { pool } = fixture;
  return {
    ...fixture,
    async seedOrg(name: string): Promise<string> {
      const { rows } = await pool.query(
        "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id",
        [name, name.toLowerCase().replace(/[^a-z0-9]+/g, "-")],
      );
      return rows[0].id as string;
    },
    async seedSpace(
      orgId: string,
      opts: { name: string; ownerUserId: string | null },
    ): Promise<string> {
      const { rows } = await pool.query(
        "INSERT INTO spaces (id, organization_id, name, owner_user_id) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id",
        [orgId, opts.name, opts.ownerUserId],
      );
      return rows[0].id as string;
    },
    async seedDatabase(spaceId: string, name: string, columns: SeedColumn[]): Promise<string> {
      const { rows } = await pool.query(
        "INSERT INTO user_databases (id, space_id, name) VALUES (gen_random_uuid(), $1, $2) RETURNING id",
        [spaceId, name],
      );
      const dbId = rows[0].id as string;
      for (const [i, c] of columns.entries()) {
        await pool.query(
          "INSERT INTO user_database_columns (database_id, name, type, config, position) VALUES ($1,$2,$3,$4,$5)",
          [dbId, c.name, c.type, JSON.stringify(c.config ?? {}), i],
        );
      }
      return dbId;
    },
  };
}

/** Colonnes et valeurs par défaut que la création d'espace et de bases du générateur exige. */
export async function enableTemplateTables(pool: { query(sql: string): Promise<unknown> }) {
  await pool.query(`
    ALTER TABLE spaces ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE spaces
      ADD COLUMN slug varchar(255) NOT NULL DEFAULT '',
      ADD COLUMN type text NOT NULL DEFAULT 'personal',
      ADD COLUMN description text,
      ADD COLUMN owner_team_id uuid,
      ADD COLUMN git_repo_path varchar(512) NOT NULL DEFAULT '',
      ADD COLUMN classification text NOT NULL DEFAULT 'internal',
      ADD COLUMN icon varchar(50),
      ADD COLUMN appearance_preset jsonb,
      ADD COLUMN is_demo boolean NOT NULL DEFAULT false,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE user_databases ALTER COLUMN id SET DEFAULT gen_random_uuid();
    ALTER TABLE user_databases
      ADD COLUMN group_id uuid, ADD COLUMN description text, ADD COLUMN icon varchar(64),
      ADD COLUMN position integer NOT NULL DEFAULT 0,
      ADD COLUMN created_by uuid,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  `);
}
