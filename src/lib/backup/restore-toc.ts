/**
 * Tables retirées du schéma (archivées dans legacy_archive), encore présentes dans `public` dans les sauvegardes 1.204.x et antérieures.
 * La restauration ignore leurs entrées (structure, données, index, contraintes)
 * pour ne pas recréer une table orpheline.
 */
export const LEGACY_TABLES = ["attachments", "studio_images"] as const;

/** Déclencheurs de synchronisation vers `media`, retirés avec les tables. */
export const LEGACY_TRIGGERS = ["trg_attachments_to_media", "trg_studio_images_to_media"] as const;

/** Fonctions de synchronisation vers `media`, retirées avec les tables. */
export const LEGACY_FUNCTIONS = ["media_sync_from_attachments", "media_sync_from_studio_images"] as const;

export interface FilteredToc {
  /** Contenu à passer à `pg_restore -L`. */
  list: string;
  /** Lignes écartées, pour le journal. */
  ignored: string[];
}

const ENTRY = /^\d+;\s+\d+\s+\d+\s+(.+)$/;
const TABLE_FIRST = ["TABLE", "TABLE DATA", "SEQUENCE", "SEQUENCE OWNED BY", "SEQUENCE SET", "ACL", "DEFAULT", "CONSTRAINT", "FK CONSTRAINT", "TRIGGER", "RULE", "POLICY", "COMMENT", "FUNCTION"];

function mentionsLegacy(body: string, tables: readonly string[]): boolean {
  // body : "<TYPE> <schema> <name> [<sous-nom>] <owner>"
  const type = [...TABLE_FIRST, "INDEX"]
    .sort((a, b) => b.length - a.length)
    .find((t) => body.startsWith(`${t} `));
  if (!type) return false;
  const tokens = body.slice(type.length + 1).split(/\s+/);
  // Seules les entrées du schéma public sont ignorées : legacy_archive (archive des tables retirées) se restaure.
  if (tokens[0] !== "public") return false;
  if (type === "FUNCTION") {
    // "public media_sync_from_attachments() owner" : le nom porte ses parenthèses.
    const fn = (tokens[1] ?? "").replace(/\(.*$/, "");
    return LEGACY_FUNCTIONS.some((f) => f === fn);
  }
  if (type === "TRIGGER" && LEGACY_TRIGGERS.some((t) => t === tokens[2])) return true;
  let name = tokens[1] ?? "";
  let indexName = type === "INDEX";
  if (type === "COMMENT" || type === "ACL") {
    // "COMMENT public TABLE attachments owner" ou "COMMENT public COLUMN attachments.col".
    const kind = tokens[1] ?? "";
    if (kind === "FUNCTION") {
      return LEGACY_FUNCTIONS.some((f) => f === (tokens[2] ?? "").replace(/\(.*$/, ""));
    }
    if (["TABLE", "COLUMN", "SEQUENCE", "INDEX", "TRIGGER"].includes(kind)) {
      name = (tokens[2] ?? "").split(".")[0];
      indexName = kind === "INDEX";
    }
  }
  if (indexName) {
    return tables.some((t) => new RegExp(`(^|_)${t}(_|$)`).test(name));
  }
  return tables.includes(name) || tables.some((t) => name.startsWith(`${t}_`) && (type.startsWith("SEQUENCE") || kindIsSequence(type, tokens)));
}

function kindIsSequence(type: string, tokens: string[]): boolean {
  return (type === "COMMENT" || type === "ACL") && tokens[1] === "SEQUENCE";
}

export function filterRestoreToc(
  toc: string,
  tables: readonly string[] = LEGACY_TABLES,
): FilteredToc {
  const kept: string[] = [];
  const ignored: string[] = [];
  for (const line of toc.split("\n")) {
    const m = ENTRY.exec(line);
    if (m && mentionsLegacy(m[1], tables)) {
      ignored.push(line);
      kept.push(`;${line}`);
    } else {
      kept.push(line);
    }
  }
  return { list: kept.join("\n"), ignored };
}
