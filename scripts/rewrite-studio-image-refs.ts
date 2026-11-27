/**
 * Réécriture des anciennes URLs `/api/studio/images/<uuid>` en `/api/media/<uuid>`
 * (la route studio est supprimée, les identifiants sont ceux de la table `media`).
 *
 * Cibles : documents (`content_text`), projets vidéo (`timeline_json`), lignes de
 * bases (`cells`), kits de marque (`logos`), tableaux blancs (`snapshot`) et designs
 * stockés sur S3 (`designs/*.json`).
 *
 * Non couvert ici : l'état Yjs binaire des documents collaboratifs, réécrit par
 * `scripts/media/rewrite-collab-states.ts` (mêmes URL studio, même identifiant).
 *
 * DRY-RUN PAR DÉFAUT : sans `--apply`, rien n'est écrit, seuls les comptes sont journalisés.
 * Idempotent : une seconde passe ne trouve plus rien.
 *
 * Usage : npx tsx scripts/rewrite-studio-image-refs.ts [--apply] [--skip-s3]
 */
import { Pool } from "pg";
import { rewriteStudioRefs } from "../src/lib/media/rewrite-document-refs";

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export interface DesignStore {
  list(): Promise<string[]>;
  read(key: string): Promise<string | null>;
  write(key: string, body: string): Promise<void>;
}

export interface Report {
  apply: boolean;
  counts: Record<string, { scanned: number; changed: number; skipped: number }>;
}

const OLD = "/api/studio/images/";

const TABLES = [
  { name: "documents", table: "documents", col: "content_text", json: false },
  { name: "video_projects", table: "video_projects", col: "timeline_json", json: true },
  { name: "user_database_rows", table: "user_database_rows", col: "cells", json: true },
  { name: "brand_kits", table: "brand_kits", col: "logos", json: true },
  { name: "whiteboard_snapshots", table: "whiteboard_snapshots", col: "snapshot", json: false },
] as const;

export async function rewriteStudioImageRefs(
  db: Queryable,
  opts: { apply: boolean; designs?: DesignStore },
): Promise<Report> {
  const report: Report = { apply: opts.apply, counts: {} };

  for (const t of TABLES) {
    const { rows } = await db.query(
      `SELECT id, ${t.col}::text AS body FROM ${t.table} WHERE ${t.col}::text LIKE '%' || $1 || '%'`,
      [OLD],
    );
    let changed = 0;
    let skipped = 0;
    for (const row of rows) {
      const before = String(row.body ?? "");
      const after = rewriteStudioRefs(before);
      if (after === before) continue;
      changed += 1;
      if (opts.apply) {
        // Écriture conditionnelle : si la ligne a été modifiée depuis la lecture
        // (sauvegarde concurrente), on la saute plutôt que de l'écraser. Relancer le script la reprend.
        const res = await db.query(
          `UPDATE ${t.table} SET ${t.col} = $1${t.json ? "::jsonb" : ""} WHERE id = $2 AND ${t.col}::text = $3`,
          [after, row.id, before],
        );
        if (!res.rowCount) skipped += 1;
      }
    }
    report.counts[t.name] = { scanned: rows.length, changed, skipped };
  }

  if (opts.designs) {
    const keys = (await opts.designs.list()).filter((k) => k.endsWith(".json"));
    let changed = 0;
    for (const key of keys) {
      const before = await opts.designs.read(key);
      if (before === null) continue;
      const after = rewriteStudioRefs(before);
      if (after === before) continue;
      changed += 1;
      if (opts.apply) await opts.designs.write(key, after);
    }
    report.counts["s3_designs"] = { scanned: keys.length, changed, skipped: 0 };
  }

  return report;
}

function format(r: Report): string {
  const lines = Object.entries(r.counts).map(
    ([k, v]) => `  ${k}: ${v.changed} à réécrire sur ${v.scanned} lignes examinées${v.skipped ? `, ${v.skipped} SAUTÉES (modifiées entre-temps, relancer)` : ""}`,
  );
  return [r.apply ? "APPLIQUÉ" : "DRY-RUN (rien n'est écrit, relancer avec --apply)", ...lines].join("\n");
}

async function s3Designs(): Promise<DesignStore> {
  const { listKeys, getFileBuffer, uploadFile } = await import("../src/lib/storage/s3");
  return {
    list: () => listKeys("designs/"),
    read: async (key) => (await getFileBuffer(key))?.toString("utf8") ?? null,
    write: async (key, body) => {
      await uploadFile(key, Buffer.from(body, "utf8"), "application/json");
    },
  };
}

if (process.argv[1]?.endsWith("rewrite-studio-image-refs.ts")) {
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  (async () => {
    const designs =
      process.argv.includes("--skip-s3") || !process.env.S3_ENDPOINT ? undefined : await s3Designs();
    if (!designs) console.log("Designs S3 ignorés (--skip-s3 ou S3_ENDPOINT absent)");
    console.log(format(await rewriteStudioImageRefs(pool, { apply, designs })));
  })()
    .then(() => pool.end().then(() => process.exit(0)))
    .catch((err) => {
      console.error("Erreur réécriture URLs studio :", err);
      process.exit(1);
    });
}
