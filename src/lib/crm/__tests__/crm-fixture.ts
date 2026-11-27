/**
 * Fixture d'integration du module CRM : etend celle de l'historique de ligne avec les tables
 * organisations, les colonnes de nom et d'archivage des bases, puis applique les migrations 0060 et 0069.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PermissionLevel } from "@/types";
import { setupRowHistoryFixture } from "@/lib/databases/__tests__/row-history-fixture";
import { setupRowTasksFixture } from "@/lib/databases/__tests__/row-tasks-fixture";
import { automationActionEnum, automationTriggerEnum } from "@/lib/db/schema";
import type { CrmDeps } from "../connection";

export const CRM_MIGRATION_PATH = join(
  process.cwd(),
  "src/lib/db/migrations/0060_crm_connections.sql",
);

export const CRM_AUTOMATION_KEYS_MIGRATION_PATH = join(
  process.cwd(),
  "src/lib/db/migrations/0069_crm_created_automation_keys.sql",
);

export async function setupCrmFixture(url: string, schemaName: string, opts: { tasks?: boolean } = {}) {
  const fixture = opts.tasks
    ? await setupRowTasksFixture(url, schemaName)
    : await setupRowHistoryFixture(url, schemaName);
  await fixture.pool.query(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug varchar(100) NOT NULL DEFAULT '',
      name varchar(255) NOT NULL DEFAULT '');
    ALTER TABLE spaces ADD COLUMN name varchar(255) NOT NULL DEFAULT '';
    ALTER TABLE user_databases
      ADD COLUMN IF NOT EXISTS name varchar(255) NOT NULL DEFAULT '',
      ADD COLUMN archived_at timestamptz,
      ADD COLUMN deleted_at timestamptz;
  `);
  await fixture.pool.query(readFileSync(CRM_MIGRATION_PATH, "utf8"));
  await fixture.pool.query(readFileSync(CRM_AUTOMATION_KEYS_MIGRATION_PATH, "utf8"));
  return fixture;
}

export type CrmFixture = Awaited<ReturnType<typeof setupCrmFixture>>;

export interface SeededCrm {
  orgA: string;
  orgB: string;
  spaceA: string;
  spaceB: string;
  /** Utilisateurs de l'organisation A : viewer sur tout, editor sur tout. */
  viewer: string;
  editor: string;
  /** Aucun droit d'espace. */
  outsider: string;
  bases: Record<"contacts" | "dossiers" | "interactions", string>;
  /** Bases de la seconde organisation (memes formes). */
  foreign: Record<"contacts" | "dossiers" | "interactions", string>;
  /** Colonnes par cle `<role>.<champ>` (organisation A). */
  col: Record<string, string>;
  dossierIds: string[];
  contactIds: string[];
  interactionIds: string[];
  levels: Record<string, Record<string, PermissionLevel>>;
  deps: CrmDeps;
}

/**
 * Trois bases raccordees (colonnes des champs principaux), 6 dossiers, 4 contacts, 5 interactions,
 * deux utilisateurs plus un sans droit, une seconde organisation avec ses bases, des vues
 * partagee et personnelles sur Dossiers, et la ligne `crm_connections` activee.
 */
export async function seedCrmBases(fx: CrmFixture, opts: { enabled?: boolean } = {}): Promise<SeededCrm> {
  const q = fx.pool.query.bind(fx.pool);
  await q(`
    CREATE TYPE database_view_type AS ENUM ('grid', 'kanban', 'gallery', 'calendar', 'form', 'dashboard');
    CREATE TABLE IF NOT EXISTS user_database_views (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_id uuid NOT NULL REFERENCES user_databases(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      type database_view_type NOT NULL,
      config jsonb NOT NULL DEFAULT '{}',
      is_default boolean NOT NULL DEFAULT false,
      is_public boolean NOT NULL DEFAULT false,
      public_token varchar(64) UNIQUE,
      position integer NOT NULL DEFAULT 0,
      scope varchar(16) NOT NULL DEFAULT 'shared',
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
  `);
  const orgA = randomUUID(), orgB = randomUUID(), spaceA = randomUUID(), spaceB = randomUUID();
  const viewer = randomUUID(), editor = randomUUID(), outsider = randomUUID();
  await q("INSERT INTO organizations (id, slug, name) VALUES ($1,'a','A'),($2,'b','B')", [orgA, orgB]);
  await q("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$3,'Espace A'),($2,$4,'Espace B')", [
    spaceA, spaceB, orgA, orgB,
  ]);
  await q("INSERT INTO users (id, name) VALUES ($1,'Viewer'),($2,'Editor'),($3,'Outsider')", [viewer, editor, outsider]);
  await q("INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'member'),($1,$3,'member'),($1,$4,'member')", [
    orgA, viewer, editor, outsider,
  ]);
  const levels: Record<string, Record<string, PermissionLevel>> = {
    [viewer]: { [spaceA]: "viewer", [spaceB]: "viewer" },
    [editor]: { [spaceA]: "editor", [spaceB]: "editor" },
    [outsider]: {},
  };
  const newDb = async (spaceId: string, name: string) => {
    const id = randomUUID();
    await q("INSERT INTO user_databases (id, space_id, name) VALUES ($1,$2,$3)", [id, spaceId, name]);
    return id;
  };
  const newCol = async (dbId: string, name: string, type: string, position: number, config: object = {}) => {
    const { rows } = await q(
      "INSERT INTO user_database_columns (database_id, name, type, position, config) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [dbId, name, type, position, JSON.stringify(config)],
    );
    return rows[0].id as string;
  };
  const newRow = async (dbId: string, cells: object, position: number) => {
    const { rows } = await q(
      "INSERT INTO user_database_rows (database_id, cells, position) VALUES ($1,$2,$3) RETURNING id",
      [dbId, JSON.stringify(cells), position],
    );
    return rows[0].id as string;
  };
  const bases = {
    contacts: await newDb(spaceA, "Contacts"),
    dossiers: await newDb(spaceA, "Dossiers"),
    interactions: await newDb(spaceA, "Interactions"),
  };
  const foreign = {
    contacts: await newDb(spaceB, "Contacts B"),
    dossiers: await newDb(spaceB, "Dossiers B"),
    interactions: await newDb(spaceB, "Interactions B"),
  };
  const col: Record<string, string> = {};
  col["contacts.nom"] = await newCol(bases.contacts, "Nom", "text", 0);
  col["contacts.email"] = await newCol(bases.contacts, "Mail", "email", 1);
  col["dossiers.titre"] = await newCol(bases.dossiers, "Titre", "text", 0);
  col["dossiers.statut"] = await newCol(bases.dossiers, "Statut", "select", 1);
  col["dossiers.montant"] = await newCol(bases.dossiers, "Montant", "number", 2);
  col["dossiers.relance"] = await newCol(bases.dossiers, "Relance", "date", 3);
  col["dossiers.responsable"] = await newCol(bases.dossiers, "Responsable", "person", 4);
  col["dossiers.contact"] = await newCol(bases.dossiers, "Contact", "relation", 5, { targetDatabaseId: bases.contacts });
  col["dossiers.cloture"] = await newCol(bases.dossiers, "Clôture", "date", 6);
  col["interactions.date"] = await newCol(bases.interactions, "Date", "date", 0);
  col["interactions.type"] = await newCol(bases.interactions, "Type", "select", 1);
  col["interactions.dossier"] = await newCol(bases.interactions, "Dossier", "relation", 2, { targetDatabaseId: bases.dossiers });
  col["interactions.intitule"] = await newCol(bases.interactions, "Intitulé", "text", 3);
  col["interactions.compte_rendu"] = await newCol(bases.interactions, "Compte rendu", "text", 4);
  col["interactions.pieces"] = await newCol(bases.interactions, "Pièces", "attachment", 5);
  await newCol(foreign.dossiers, "Titre", "text", 0);

  const contactIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    contactIds.push(await newRow(bases.contacts, { [col["contacts.nom"]]: `Contact ${i + 1}`, [col["contacts.email"]]: `c${i + 1}@x.fr` }, i));
  }
  const statuts = ["Prospect", "Devis", "Devis", "Signé", "Perdu", "Prospect"];
  const dossierIds: string[] = [];
  for (let i = 0; i < 6; i++) {
    dossierIds.push(
      await newRow(
        bases.dossiers,
        {
          [col["dossiers.titre"]]: `Dossier ${i + 1}`,
          [col["dossiers.statut"]]: statuts[i],
          [col["dossiers.montant"]]: (i + 1) * 1000,
          [col["dossiers.contact"]]: [contactIds[i % 4]],
          [col["dossiers.responsable"]]: i % 2 === 0 ? editor : viewer,
        },
        i,
      ),
    );
  }
  const interactionIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    interactionIds.push(
      await newRow(
        bases.interactions,
        { [col["interactions.date"]]: `2026-11-0${i + 1}`, [col["interactions.type"]]: "Appel", [col["interactions.dossier"]]: [dossierIds[i]] },
        i,
      ),
    );
  }
  await newRow(foreign.dossiers, { x: "etranger" }, 0);

  await q(
    `INSERT INTO user_database_views (database_id, name, type, scope, created_by, is_default, position) VALUES
      ($1,'Tableau','grid','shared',NULL,true,0),
      ($1,'Perso viewer','grid','personal',$2,false,1),
      ($1,'Perso editor','grid','personal',$3,false,2)`,
    [bases.dossiers, viewer, editor],
  );
  const fieldMap = {
    contacts: { nom: col["contacts.nom"], email: col["contacts.email"] },
    dossiers: {
      titre: col["dossiers.titre"],
      statut: col["dossiers.statut"],
      montant: col["dossiers.montant"],
      relance: col["dossiers.relance"],
      responsable: col["dossiers.responsable"],
      contact: col["dossiers.contact"],
      cloture: col["dossiers.cloture"],
    },
    interactions: {
      date: col["interactions.date"],
      type: col["interactions.type"],
      dossier: col["interactions.dossier"],
      intitule: col["interactions.intitule"],
      compte_rendu: col["interactions.compte_rendu"],
      pieces: col["interactions.pieces"],
    },
  };
  await q(
    `INSERT INTO crm_connections (organization_id, enabled, contacts_database_id, deals_database_id,
      interactions_database_id, field_map) VALUES ($1, $2, $3, $4, $5, $6)`,
    [orgA, opts.enabled ?? true, bases.contacts, bases.dossiers, bases.interactions, JSON.stringify(fieldMap)],
  );
  const deps: CrmDeps = {
    executor: fx.db,
    permissionOf: async (userId, spaceId) => levels[userId]?.[spaceId] ?? null,
  };
  return { orgA, orgB, spaceA, spaceB, viewer, editor, outsider, bases, foreign, col, dossierIds, contactIds, interactionIds, levels, deps };
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
  const enumSql = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");
  await fixture.pool.query(`
    CREATE TYPE database_automation_trigger AS ENUM (${enumSql(automationTriggerEnum.enumValues)});
    CREATE TYPE database_automation_action AS ENUM (${enumSql(automationActionEnum.enumValues)});
    CREATE TABLE automations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      database_id uuid REFERENCES user_databases(id) ON DELETE CASCADE,
      space_id uuid REFERENCES spaces(id) ON DELETE CASCADE,
      name varchar(255) NOT NULL,
      trigger_type database_automation_trigger NOT NULL,
      trigger_config jsonb NOT NULL DEFAULT '{}',
      action_type database_automation_action NOT NULL,
      action_config jsonb NOT NULL DEFAULT '{}',
      graph jsonb,
      enabled boolean NOT NULL DEFAULT true,
      last_run_at timestamptz,
      created_by uuid REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE automation_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
      triggered_at timestamptz NOT NULL DEFAULT now(),
      status varchar(20) NOT NULL,
      duration_ms integer,
      error_message text,
      payload jsonb,
      steps jsonb,
      trace_truncated boolean NOT NULL DEFAULT false,
      source varchar(20) NOT NULL DEFAULT 'trigger');
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
