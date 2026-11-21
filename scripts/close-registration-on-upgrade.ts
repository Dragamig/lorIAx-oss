/**
 * Mise a jour vers 2.0.0 (edition oss seulement) : en 1.21.x, chaque enregistrement de l'onglet Systeme
 * stockait `auth.allowRegistration = true` (valeur par defaut de l'interrupteur, jamais choisie). En 2.0.0
 * oss, `true` vaut ouverture explicite : on referme donc l'inscription une seule fois, au premier
 * deploiement 2.0.0, puis un marqueur interdit de rejouer. Un administrateur la rouvre ensuite dans les
 * reglages systeme, et ce choix n'est plus jamais ecrase.
 * L'edition commerciale (module `commercial`) n'est jamais touchee.
 */
import type { Pool } from "pg";
import type { ModuleId } from "../src/lib/modules/types";

export const REGISTRATION_UPGRADE_MARKER = "oss_registration_closed_v2";

export type CloseRegistrationResult = { ran: boolean; closed: boolean };

export async function closeRegistrationOnUpgrade(
  pool: Pool,
  includedModuleIds: readonly ModuleId[]
): Promise<CloseRegistrationResult> {
  if (includedModuleIds.includes("commercial")) return { ran: false, closed: false };

  // Une seule instruction : le marqueur et la fermeture reussissent ou echouent ensemble.
  const res = await pool.query<{ marked: string; closed: string }>(
    "WITH m AS (INSERT INTO system_settings (key, value) VALUES ($1, 'true'::jsonb) ON CONFLICT (key) DO NOTHING RETURNING key), " +
      "u AS (UPDATE system_settings SET value = jsonb_set(value, '{allowRegistration}', 'false'::jsonb), updated_at = now() " +
      "WHERE key = 'auth' AND value -> 'allowRegistration' = 'true'::jsonb AND EXISTS (SELECT 1 FROM m) RETURNING key) " +
      "SELECT (SELECT count(*) FROM m) AS marked, (SELECT count(*) FROM u) AS closed",
    [REGISTRATION_UPGRADE_MARKER]
  );
  const row = res.rows[0];
  return { ran: Number(row?.marked ?? 0) > 0, closed: Number(row?.closed ?? 0) > 0 };
}
