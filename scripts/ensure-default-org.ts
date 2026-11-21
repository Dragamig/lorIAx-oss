/**
 * Garantit qu'une organisation active existe, independamment de tout module
 * commercial (facturation, licence, inscription cloud). Sur une base vide,
 * l'assistant de configuration s'appuie sur `getDefaultOrgId`, qui leve une
 * erreur sans organisation : on la cree ici, au deploiement.
 *
 * Meme critere que `getDefaultOrgId` : premiere organisation active, par
 * `created_at` croissant. Idempotent, ne modifie jamais une organisation existante.
 */
import type { Pool } from "pg";

const DEFAULT_ORG_NAME = "Organisation";
const DEFAULT_ORG_SLUG = "default";

const SELECT_FIRST_ACTIVE =
  "SELECT id FROM organizations WHERE is_active = true ORDER BY created_at ASC LIMIT 1";

export async function ensureDefaultOrganization(
  pool: Pool
): Promise<{ id: string; created: boolean }> {
  const existing = await pool.query<{ id: string }>(SELECT_FIRST_ACTIVE);
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };

  const inserted = await pool.query<{ id: string }>(
    "INSERT INTO organizations (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO NOTHING RETURNING id",
    [DEFAULT_ORG_NAME, DEFAULT_ORG_SLUG]
  );
  if (inserted.rows[0]) return { id: inserted.rows[0].id, created: true };

  // Course avec un autre processus, ou slug deja pris par une organisation inactive.
  const raced = await pool.query<{ id: string }>(SELECT_FIRST_ACTIVE);
  if (raced.rows[0]) return { id: raced.rows[0].id, created: false };
  throw new Error(
    `Impossible de creer l'organisation par defaut : le slug "${DEFAULT_ORG_SLUG}" est pris par une organisation inactive`
  );
}
