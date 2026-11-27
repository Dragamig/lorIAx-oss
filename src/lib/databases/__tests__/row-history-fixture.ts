/**
 * Schema dedie par fichier de test (rh_<suite>) et DDL minimale partages par les tests d'integration de l'historique de ligne.
 * Les tables portent les cles etrangeres du schema Drizzle utiles a la capture.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import { readRowHistorySql } from "../../../../scripts/migrate-row-history";

/** Un schema par fichier de test : vitest lance les fichiers en parallele sur la meme base. */
export async function setupRowHistoryFixture(
  url: string,
  schemaName: string,
): Promise<{
  /** Nom du schema cree pour ce fichier. */
  schema: string;
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  teardown(): Promise<void>;
}> {
  if (!/^rh_[a-z0-9_]+$/.test(schemaName)) throw new Error(`Nom de schema invalide : ${schemaName}`);
  const admin = new Pool({ connectionString: url });
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.end();
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schemaName}` });
  const db = drizzle(pool, { schema });
  await pool.query(`
    CREATE TYPE row_change_kind AS ENUM ('created', 'updated', 'deleted');
    CREATE TYPE row_change_source AS ENUM
      ('ui', 'automation', 'import', 'public_form', 'sync', 'relation_sync', 'restore', 'system', 'ai');
    CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name varchar(255) NOT NULL DEFAULT '');
    CREATE TABLE organization_members (
      organization_id uuid NOT NULL, user_id uuid NOT NULL,
      role text NOT NULL DEFAULT 'member', PRIMARY KEY (organization_id, user_id));
    CREATE TABLE spaces (id uuid PRIMARY KEY, organization_id uuid);
    CREATE TABLE user_databases (id uuid PRIMARY KEY, space_id uuid NOT NULL);
    CREATE TABLE user_database_columns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), database_id uuid NOT NULL,
      name varchar(255) NOT NULL, type text NOT NULL DEFAULT 'text',
      position integer NOT NULL DEFAULT 0, config jsonb DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE user_database_rows (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
      cells jsonb NOT NULL DEFAULT '{}', position integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE external_database_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_database_id uuid NOT NULL);
    CREATE TABLE external_row_tracking (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      mapping_id uuid NOT NULL REFERENCES external_database_mappings(id) ON DELETE CASCADE,
      loriax_row_id uuid NOT NULL REFERENCES user_database_rows(id) ON DELETE CASCADE,
      external_row_id varchar(512) NOT NULL, content_hash varchar(64),
      last_external_change_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE activity_log (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action varchar(100) NOT NULL, entity_type varchar(50) NOT NULL,
      entity_id uuid NOT NULL, metadata jsonb DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE database_row_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
      row_id uuid NOT NULL,
      kind row_change_kind NOT NULL,
      source row_change_source NOT NULL,
      actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      actor_label varchar(120),
      automation_id uuid,
      batch_id uuid NOT NULL,
      changes jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now());
  `);
  await pool.query(readRowHistorySql());
  return {
    schema: schemaName,
    pool,
    db,
    async teardown() {
      await pool.end();
      const cleaner = new Pool({ connectionString: url });
      try {
        await cleaner.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      } finally {
        await cleaner.end();
      }
    },
  };
}
