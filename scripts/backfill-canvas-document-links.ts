/**
 * Backfill : rattachement des canevas (tableau blanc, mind map, design) au
 * document qui les porte.
 *
 * Pourquoi un script et pas un simple .sql : `drizzle-kit push` (joué par
 * `scripts/init-db.ts` au déploiement) synchronise la STRUCTURE, jamais les
 * données. Il crée `whiteboard_snapshots.document_id`, `mindmap_snapshots.
 * document_id` et la table `design_snapshots`, mais laisse toutes les lignes
 * préexistantes à NULL. Or les routes sont fail-closed : une ligne sans
 * rattachement devient inaccessible. Sans ce backfill, tous les canevas
 * existants seraient perdus pour leurs utilisateurs.
 *
 * Principe : les identifiants de canevas sont écrits en clair dans le markdown
 * du document (attributs de nœud TipTap sérialisés en HTML brut), donc
 * présents dans `documents.content_text`. On retrouve le porteur par simple
 * recherche de sous-chaîne.
 *
 * Idempotent : ne touche que les lignes à `document_id` NULL, et n'insère une
 * ligne `design_snapshots` que si elle n'existe pas.
 *
 * Ambiguïté (même identifiant dans deux documents, suite à un copier-coller de
 * bloc) : on retient le document le plus anciennement modifié et on journalise
 * le conflit.
 *
 * Usage : npx tsx scripts/backfill-canvas-document-links.ts
 */
import { Pool } from "pg";

interface Stats {
  whiteboard: { before: number; linked: number; after: number };
  mindmap: { before: number; linked: number; after: number };
  design: { created: number; linked: number; after: number };
  conflicts: number;
}

/**
 * Documents citant `resourceId` dans leur contenu, du plus anciennement
 * modifié au plus récent.
 */
async function findCarrierDocuments(
  pool: Pool,
  resourceId: string
): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM documents
      WHERE content_text LIKE '%' || $1 || '%'
      ORDER BY updated_at ASC`,
    [resourceId]
  );
  return rows.map((r) => r.id);
}

async function countUnlinked(pool: Pool, table: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE document_id IS NULL`
  );
  return Number(rows[0]?.count ?? "0");
}

export async function backfillCanvasDocumentLinks(
  connectionString = process.env.DATABASE_URL
): Promise<Stats | null> {
  const pool = new Pool({ connectionString });
  const stats: Stats = {
    whiteboard: { before: 0, linked: 0, after: 0 },
    mindmap: { before: 0, linked: 0, after: 0 },
    design: { created: 0, linked: 0, after: 0 },
    conflicts: 0,
  };

  try {
    stats.whiteboard.before = await countUnlinked(pool, "whiteboard_snapshots");
    stats.mindmap.before = await countUnlinked(pool, "mindmap_snapshots");

    // ── Tableaux blancs et mind maps : lignes déjà présentes, lien à poser ──
    for (const [table, idCol, key] of [
      ["whiteboard_snapshots", "canvas_id", "whiteboard"],
      ["mindmap_snapshots", "mindmap_id", "mindmap"],
    ] as const) {
      const { rows } = await pool.query<{ rid: string }>(
        `SELECT ${idCol} AS rid FROM ${table} WHERE document_id IS NULL`
      );
      for (const { rid } of rows) {
        const carriers = await findCarrierDocuments(pool, rid);
        if (carriers.length === 0) continue;
        if (carriers.length > 1) {
          stats.conflicts++;
          console.warn(
            `⚠ ${key} ${rid} cité par ${carriers.length} documents ` +
              `(${carriers.join(", ")}) — rattaché au plus ancien : ${carriers[0]}`
          );
        }
        await pool.query(
          `UPDATE ${table} SET document_id = $1 WHERE ${idCol} = $2 AND document_id IS NULL`,
          [carriers[0], rid]
        );
        stats[key].linked++;
      }
      stats[key].after = await countUnlinked(pool, table);
    }

    // ── Designs : la table de métadonnées est neuve, il faut créer les lignes
    //    à partir des identifiants trouvés dans les documents. Sans cela, tout
    //    design préexistant resterait sans ligne, donc adoptable par le premier
    //    appelant venu (chemin « création »). ─────────────────────────────────
    const { rows: docs } = await pool.query<{
      id: string;
      content_text: string | null;
    }>(
      `SELECT id, content_text FROM documents
        WHERE content_text LIKE '%design-block%'
        ORDER BY updated_at ASC`
    );

    const designToDoc = new Map<string, string>();
    // Le bloc est sérialisé en HTML brut (`atom: true` + Markdown html:true).
    // On repère la balise du bloc, puis le premier UUID qu'elle contient :
    // insensible à l'ordre et à la casse des attributs.
    const blockRe = /<div[^>]*design-block[^>]*>/gi;
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const doc of docs) {
      const text = doc.content_text ?? "";
      blockRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = blockRe.exec(text)) !== null) {
        const found = uuidRe.exec(m[0]);
        if (!found) continue;
        const designId = found[0].toLowerCase();
        // Documents parcourus du plus ancien au plus récent : le premier vu
        // gagne, conformément à la règle de résolution des conflits.
        if (designToDoc.has(designId)) {
          if (designToDoc.get(designId) !== doc.id) {
            stats.conflicts++;
            console.warn(
              `⚠ design ${designId} cité par plusieurs documents — rattaché au ` +
                `plus ancien : ${designToDoc.get(designId)}`
            );
          }
          continue;
        }
        designToDoc.set(designId, doc.id);
      }
    }

    for (const [designId, documentId] of designToDoc) {
      const res = await pool.query(
        `INSERT INTO design_snapshots (design_id, document_id)
              VALUES ($1, $2)
         ON CONFLICT (design_id) DO UPDATE
                SET document_id = EXCLUDED.document_id, updated_at = now()
              WHERE design_snapshots.document_id IS NULL`,
        [designId, documentId]
      );
      if (res.rowCount) stats.design.created++;
    }
    stats.design.linked = stats.design.created;
    stats.design.after = await countUnlinked(pool, "design_snapshots");

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

function report(stats: Stats): void {
  console.log(
    `whiteboard_snapshots : ${stats.whiteboard.before} non rattaché(s) avant, ` +
      `${stats.whiteboard.linked} rattaché(s), ${stats.whiteboard.after} restant(s)`
  );
  console.log(
    `mindmap_snapshots    : ${stats.mindmap.before} non rattaché(s) avant, ` +
      `${stats.mindmap.linked} rattaché(s), ${stats.mindmap.after} restant(s)`
  );
  console.log(
    `design_snapshots     : ${stats.design.created} ligne(s) créée(s)/rattachée(s), ` +
      `${stats.design.after} restant(s) sans document`
  );
  if (stats.conflicts > 0) {
    console.warn(`${stats.conflicts} conflit(s) d'identifiant journalisé(s) ci-dessus`);
  }
  const remaining =
    stats.whiteboard.after + stats.mindmap.after + stats.design.after;
  if (remaining > 0) {
    console.warn(
      `${remaining} canevas restent sans document porteur : ils deviennent ` +
        `inaccessibles (orphelins — bloc supprimé du document, ou document effacé).`
    );
  }
}

// Exécution directe (npx tsx scripts/backfill-canvas-document-links.ts)
if (process.argv[1]?.endsWith("backfill-canvas-document-links.ts")) {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }
  backfillCanvasDocumentLinks()
    .then((stats) => {
      if (stats) report(stats);
      else console.log("Tables absentes — rien à faire");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Erreur backfill canvas :", err);
      process.exit(1);
    });
}
