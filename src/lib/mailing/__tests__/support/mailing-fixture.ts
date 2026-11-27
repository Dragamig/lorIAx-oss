/**
 * Fixture d'intégration du Mailing : base de test (schéma dédié), organisations, utilisateurs,
 * migrations 0061 à 0064 et un CRM raccordé (Contacts, Dossiers, Interactions) par organisation.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setupCrmFixture } from "@/lib/crm/__tests__/crm-fixture";

export interface CrmIds {
  orgId: string;
  contacts: string;
  dossiers: string;
  interactions: string;
  col: Record<string, string>;
}

export async function setupMailingFixture(url: string, schemaName: string) {
  const fx = await setupCrmFixture(url, schemaName);
  await fx.pool.query(`
    ALTER TABLE organizations
      ADD COLUMN is_active boolean NOT NULL DEFAULT true,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  `);
  for (const f of ["0061_mail_accounts.sql", "0062_mail_messages.sql", "0063_mail_trace_attempts.sql", "0064_mail_messages_account_set_null.sql"]) {
    await fx.pool.query(readFileSync(join(process.cwd(), "src/lib/db/migrations", f), "utf8"));
  }

  async function newOrg(slug: string, createdAgo = "0 seconds"): Promise<string> {
    const id = randomUUID();
    await fx.pool.query(
      `INSERT INTO organizations (id, slug, name, created_at) VALUES ($1,$2,$2, now() - $3::interval)`,
      [id, slug, createdAgo],
    );
    return id;
  }
  async function newUser(orgId?: string): Promise<string> {
    const id = randomUUID();
    await fx.pool.query("INSERT INTO users (id) VALUES ($1)", [id]);
    if (orgId) {
      await fx.pool.query("INSERT INTO organization_members (organization_id, user_id) VALUES ($1,$2)", [orgId, id]);
    }
    return id;
  }
  async function newDb(spaceId: string, name: string) {
    const id = randomUUID();
    await fx.pool.query("INSERT INTO user_databases (id, space_id, name) VALUES ($1,$2,$3)", [id, spaceId, name]);
    return id;
  }
  async function newCol(dbId: string, name: string, type: string, config: object = {}) {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_columns (database_id, name, type, config) VALUES ($1,$2,$3,$4) RETURNING id",
      [dbId, name, type, JSON.stringify(config)],
    );
    return rows[0].id as string;
  }
  async function newRow(dbId: string, cells: object) {
    const { rows } = await fx.pool.query(
      "INSERT INTO user_database_rows (database_id, cells) VALUES ($1,$2) RETURNING id",
      [dbId, JSON.stringify(cells)],
    );
    return rows[0].id as string;
  }

  /** CRM complet et raccordé pour une organisation (Interactions dans un espace à part). */
  async function newCrm(orgId: string, label: string): Promise<CrmIds> {
    const sp = randomUUID();
    const spIx = randomUUID();
    await fx.pool.query("INSERT INTO spaces (id, organization_id, name) VALUES ($1,$3,$4),($2,$3,$5)", [
      sp, spIx, orgId, `${label} base`, `${label} interactions`,
    ]);
    const contacts = await newDb(sp, `${label} Contacts`);
    const dossiers = await newDb(sp, `${label} Dossiers`);
    const interactions = await newDb(spIx, `${label} Interactions`);
    const col: Record<string, string> = {};
    col.cNom = await newCol(contacts, "Nom", "text");
    col.cMail = await newCol(contacts, "Mail", "email");
    col.dTitre = await newCol(dossiers, "Titre", "text");
    col.dStatut = await newCol(dossiers, "Statut", "select", { options: ["Nouveau", "Gagné"] });
    col.dContact = await newCol(dossiers, "Contact", "relation", { targetDatabaseId: contacts });
    col.iDate = await newCol(interactions, "Date", "date");
    col.iType = await newCol(interactions, "Type", "select", { options: ["Appel"] });
    col.iDossier = await newCol(interactions, "Dossier", "relation", { targetDatabaseId: dossiers });
    col.iContact = await newCol(interactions, "Contact", "relation", { targetDatabaseId: contacts });
    col.iSens = await newCol(interactions, "Sens", "select", { options: [] });
    col.iTitre = await newCol(interactions, "Intitulé", "text");
    col.iNotes = await newCol(interactions, "Compte rendu", "text");
    col.iPieces = await newCol(interactions, "Pièces", "attachment");
    const fieldMap = {
      contacts: { nom: col.cNom, email: col.cMail },
      dossiers: { titre: col.dTitre, statut: col.dStatut, contact: col.dContact },
      interactions: {
        date: col.iDate, type: col.iType, dossier: col.iDossier, contact: col.iContact,
        sens: col.iSens, intitule: col.iTitre, compte_rendu: col.iNotes, pieces: col.iPieces,
      },
    };
    await fx.pool.query(
      `INSERT INTO crm_connections (organization_id, enabled, contacts_database_id, deals_database_id,
        interactions_database_id, field_map) VALUES ($1,true,$2,$3,$4,$5)`,
      [orgId, contacts, dossiers, interactions, JSON.stringify(fieldMap)],
    );
    return { orgId, contacts, dossiers, interactions, col };
  }

  return { ...fx, newOrg, newUser, newDb, newCol, newRow, newCrm };
}
