/**
 * Backfill : rattachement des tableurs (`spreadsheet_data.space_id`) à l'espace
 * du document qui les porte.
 *
 * Pourquoi un script et pas un simple .sql : `drizzle-kit push` (joué par
 * `scripts/init-db.ts` au déploiement) synchronise la STRUCTURE, jamais les
 * données. La colonne `spreadsheet_data.space_id` existe, mais le client
 * n'envoyait pas `spaceId` jusqu'à présent : toutes les lignes antérieures sont
 * donc à NULL. Or la route `/api/spreadsheet/[sheetId]` est désormais
 * fail-closed (404 en lecture, 403 en écriture sans espace de rattachement) :
 * sans ce backfill, tous les tableurs existants deviendraient inaccessibles.
 *
 * Principe : le `sheetId` est un attribut du nœud TipTap `spreadsheetBlock`,
 * nœud atomique sérialisé en HTML brut dans le markdown du document
 * (`tiptap-markdown` configuré `html: true`), donc présent dans
 * `documents.content_text`. Attention : la sérialisation DOM met les noms
 * d'attributs en minuscules — on lit `sheetid=`, pas `sheetId=`. On repère donc
 * la balise du bloc (`data-type="spreadsheet-block"`), puis l'identifiant
 * qu'elle contient, en insensible à la casse et avec repli sur le premier UUID
 * de la balise.
 *
 * Idempotent : ne met à jour que les lignes à `space_id` NULL.
 *
 * Ambiguïté (même `sheetId` dans deux documents, suite à un copier-coller de
 * bloc) : on retient le document le plus anciennement modifié et on journalise.
 *
 * Usage : npx tsx scripts/backfill-spreadsheet-space.ts
 */
import { Pool } from "pg";

export interface SpreadsheetBackfillStats {
  before: number;
  linked: number;
  after: number;
  conflicts: number;
}

export interface CarrierDocument {
  id: string;
  contentText: string | null;
}

export interface SheetLinkExtraction {
  /** sheetId → id du document porteur retenu (le plus anciennement modifié). */
  links: Map<string, string>;
  /** Messages de conflit à journaliser (même sheetId dans plusieurs documents). */
  conflicts: string[];
}

// Le bloc est atomique (`atom: true`) : il est sérialisé en une balise `div`
// autonome portant `data-type="spreadsheet-block"`.
const BLOCK_RE = /<div[^>]*spreadsheet-block[^>]*>/gi;
// Sérialisation DOM ⇒ attribut en minuscules (`sheetid`). Insensible à la casse
// par sécurité, guillemets simples ou doubles acceptés.
const SHEET_ATTR_RE = /\bsheetid\s*=\s*("([^"]*)"|'([^']*)')/i;
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** Identifiant de tableur porté par une balise de bloc, s'il y en a un. */
function sheetIdFromTag(tag: string): string | null {
  const attr = SHEET_ATTR_RE.exec(tag);
  const value = attr ? (attr[2] ?? attr[3] ?? "").trim() : "";
  if (value && value !== "null") return value;
  // Repli : première graphie d'UUID de la balise (les sheetId sont générés par
  // `crypto.randomUUID()` côté éditeur).
  const uuid = UUID_RE.exec(tag);
  return uuid ? uuid[0] : null;
}

/**
 * Construit la table sheetId → document porteur.
 *
 * `docs` DOIT être trié du document le plus anciennement modifié au plus
 * récent : le premier vu gagne, conformément à la règle de résolution des
 * conflits.
 */
export function extractSheetLinks(docs: CarrierDocument[]): SheetLinkExtraction {
  const links = new Map<string, string>();
  const conflicts: string[] = [];

  for (const doc of docs) {
    const text = doc.contentText ?? "";
    BLOCK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = BLOCK_RE.exec(text)) !== null) {
      const sheetId = sheetIdFromTag(match[0]);
      if (!sheetId) continue;
      const known = links.get(sheetId);
      if (known !== undefined) {
        if (known !== doc.id) {
          conflicts.push(
            `⚠ tableur ${sheetId} cité par plusieurs documents ` +
              `(${known}, ${doc.id}) — rattaché au plus ancien : ${known}`
          );
        }
        continue;
      }
      links.set(sheetId, doc.id);
    }
  }

  return { links, conflicts };
}

async function countUnscoped(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM spreadsheet_data WHERE space_id IS NULL"
  );
  return Number(rows[0]?.count ?? "0");
}

export async function backfillSpreadsheetSpace(
  connectionString = process.env.DATABASE_URL
): Promise<SpreadsheetBackfillStats | null> {
  const pool = new Pool({ connectionString });
  const stats: SpreadsheetBackfillStats = {
    before: 0,
    linked: 0,
    after: 0,
    conflicts: 0,
  };

  try {
    stats.before = await countUnscoped(pool);
    if (stats.before === 0) return stats;

    const { rows: docs } = await pool.query<{
      id: string;
      content_text: string | null;
    }>(
      `SELECT id, content_text FROM documents
        WHERE content_text LIKE '%spreadsheet-block%'
        ORDER BY updated_at ASC`
    );

    const { links, conflicts } = extractSheetLinks(
      docs.map((d) => ({ id: d.id, contentText: d.content_text }))
    );
    stats.conflicts = conflicts.length;
    for (const message of conflicts) console.warn(message);

    for (const [sheetId, documentId] of links) {
      // `space_id` du document porteur ; la clause `IS NOT NULL` évite d'écrire
      // un NULL si le document a disparu entre-temps.
      const res = await pool.query(
        `UPDATE spreadsheet_data sd
            SET space_id = d.space_id, updated_at = now()
           FROM documents d
          WHERE d.id = $1
            AND sd.sheet_id = $2
            AND sd.space_id IS NULL
            AND d.space_id IS NOT NULL`,
        [documentId, sheetId]
      );
      if (res.rowCount) stats.linked += res.rowCount;
    }

    stats.after = await countUnscoped(pool);
    return stats;
  } catch (e) {
    // Tables absentes sur BDD neuve (push pas encore joué) → no-op.
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not exist/i.test(msg)) return null;
    throw e;
  } finally {
    await pool.end();
  }
}

function report(stats: SpreadsheetBackfillStats): void {
  console.log(
    `spreadsheet_data : ${stats.before} sans espace avant, ` +
      `${stats.linked} rattaché(s), ${stats.after} restant(s)`
  );
  if (stats.conflicts > 0) {
    console.warn(
      `${stats.conflicts} conflit(s) d'identifiant journalisé(s) ci-dessus`
    );
  }
  if (stats.after > 0) {
    console.warn(
      `${stats.after} tableur(s) restent sans espace porteur : ils deviennent ` +
        `inaccessibles (orphelins — bloc supprimé du document, ou document effacé).`
    );
  }
}

// Exécution directe (npx tsx scripts/backfill-spreadsheet-space.ts)
if (process.argv[1]?.endsWith("backfill-spreadsheet-space.ts")) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }
  backfillSpreadsheetSpace()
    .then((stats) => {
      if (stats) report(stats);
      else console.log("Tables absentes — rien à faire");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erreur backfill tableurs :", err);
      process.exit(1);
    });
}
