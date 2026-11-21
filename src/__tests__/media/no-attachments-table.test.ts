import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";

const APP = path.resolve(__dirname, "../../..");
const ROOTS = ["src", "scripts"];
/** Fichiers isolés à la racine de l'application. */
const ROOT_FILES = ["server.ts"];

/**
 * Anciennes tables remplacées par la médiathèque : `attachments` (identifiant Drizzle
 * `attachments`) et `studio_images` (identifiant `studioImages`).
 *
 * Limites connues, non détectées : un nom de table reconstruit à l'exécution
 * (`"attach" + "ments"`, gabarit `${prefix}ments`) et une table désignée par une variable.
 * Le motif de concaténation ci-dessous n'attrape que les fragments littéraux évidents.
 */

/** Import (avec ou sans alias) depuis un module de schéma : `import { attachments as a } from "@/lib/db/schema"`. */
const SCHEMA_IMPORT_RE = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']*db\/schema[^"']*["']/g;
const IDENT_RE = /\b(attachments|studioImages)\b/;
/** Accès par espace de noms ou déclaration de l'identifiant. */
const NAMESPACE_RE = /\b(?:schema|schemaMedia|dbSchema)\.(attachments|studioImages)\b/;
const DECLARATION_RE = /\bexport\s+(?:const|let|var)\s+(attachments|studioImages)\b/;
/** SQL brut : verbes suivis du nom de table (sql.raw, db.execute, chaînes de script, DDL). */
const SQL_RE =
  /\b(?:FROM|JOIN|INTO|UPDATE|REFERENCES|TRIGGER\s+ON|ON|TRUNCATE(?:\s+TABLE)?|COPY|LOCK(?:\s+TABLE)?|TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?)\s+(?:ONLY\s+)?(?:"?public"?\.)?"?(?:attachments|studio_images)\b/i;
/** Seconde table d'une liste FROM séparée par des virgules : `FROM spaces s, attachments a`. */
const COMMA_FROM_RE = /\bFROM\b[^;]{0,200}?,\s*"?(?:public"?\.)?"?(?:attachments|studio_images)\b/i;
/** Nom de table entre guillemets, par exemple dans une liste de tables. */
const QUOTED_RE = /["'`](?:attachments|studio_images)["'`]/;
/** Fragment littéral évident d'une concaténation de nom de table. */
const JOIN_ARRAY_RE = /\[\s*["'`](?:attach|attachm|studio_|studio_im)["'`]\s*,\s*["'`](?:ments|ages|images|achments)["'`]\s*\]\s*\.join/;
const CONCAT_RE = /["'`](?:attach|attachm|studio_|studio_im)["'`]\s*\+\s*["'`](?:ments|ages|images|achments)["'`]/;

function stripComments(src: string): string {
  // Un bloc `/* ... */` n'est retiré que s'il commence en début de ligne ou après un blanc : un `/*` collé à une
  // chaîne (`"uploads/*"`) ne doit pas masquer le code qui suit.
  return src.replace(/(^|\s)\/\*[\s\S]*?\*\//g, "$1").replace(/^\s*\/\/.*$/gm, "");
}

function usesOldTables(code: string): boolean {
  const clean = stripComments(code);
  for (const m of clean.matchAll(SCHEMA_IMPORT_RE)) {
    if (IDENT_RE.test(m[1])) return true;
  }
  return (
    NAMESPACE_RE.test(clean) ||
    DECLARATION_RE.test(clean) ||
    SQL_RE.test(clean) ||
    QUOTED_RE.test(clean) ||
    CONCAT_RE.test(clean) ||
    JOIN_ARRAY_RE.test(clean) ||
    COMMA_FROM_RE.test(clean)
  );
}

/** Écarts permanents, chacun avec sa raison. */
const PERMANENT: Record<string, string> = {
  "scripts/media/lib/copy-integrity.ts":
    "fragments SQL partagés de contrôle de copie, nomment les anciennes tables sans les lire ni les écrire",
  "scripts/media/count-legacy-refs.ts":
    "lecture seule des anciennes tables pour mesurer l'intégrité de la copie, tolère leur absence, aucune écriture",
  "src/lib/backup/restore-toc.ts":
    "LEGACY_TABLES : filtre de restauration qui ignore la table attachments des sauvegardes anciennes, aucune lecture ni écriture",
};
const PERMANENT_EXPECTED: Record<string, string> = {
  "scripts/retire-attachments.ts": "DDL de retrait des tables attachments et studio_images",
};

const ALLOWED: Record<string, string> = { ...PERMANENT, ...PERMANENT_EXPECTED };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mts|cts|mjs|cjs|js|sh)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function sources(): string[] {
  return [...ROOTS.flatMap((r) => walk(path.join(APP, r))), ...ROOT_FILES.map((f) => path.join(APP, f))]
    .map((f) => path.relative(APP, f).split(path.sep).join("/"))
    .filter((rel) => !rel.startsWith("src/tests/") && !rel.startsWith("src/__tests__/"));
}

describe("garde-fou : plus de lecture ni d'écriture de attachments et studio_images", () => {
  it("aucun fichier hors liste blanche n'utilise les anciennes tables", () => {
    const offenders = sources()
      .filter((rel) => usesOldTables(readFileSync(path.join(APP, rel), "utf8")))
      .filter((rel) => !(rel in ALLOWED));
    expect(offenders).toEqual([]);
  });

  it("chaque entrée de la liste blanche existe encore et en a besoin", () => {
    for (const rel of Object.keys({ ...PERMANENT, ...PERMANENT_EXPECTED })) {
      const abs = path.join(APP, rel);
      expect(existsSync(abs), `${rel} n'existe plus, retirer son entrée`).toBe(true);
      expect(usesOldTables(readFileSync(abs, "utf8")), `${rel} n'a plus besoin de son entrée`).toBe(true);
    }
  });

  it("chaque motif attrape sa fixture, y compris les contournements simples", () => {
    for (const code of [
      'import { attachments } from "@/lib/db/schema";',
      'import { attachments as a, eq } from "@/lib/db/schema";',
      'import { studioImages } from "@/lib/db/schema";',
      'import {\n  eq,\n  studioImages as si,\n} from "../db/schema";',
      "db.select().from(schema.attachments)",
      "export const attachments = pgTable(",
      "await db.execute(sql`SELECT id FROM attachments WHERE x`)",
      'sql.raw("DELETE FROM studio_images")',
      'sql.raw(`INSERT INTO "attachments" (a) VALUES (1)`)',
      "UPDATE attachments SET a = 1",
      "LEFT JOIN studio_images si ON si.id = x",
      "CREATE TRIGGER t BEFORE DELETE ON attachments",
      "DROP TABLE IF EXISTS studio_images",
      "ALTER TABLE public.attachments ADD COLUMN x int",
      'const TABLES = ["users", "attachments"];',
      "const TABLES = ['studio_images'];",
      'const t = "attach" + "ments";',
      'const t = ["attach", "ments"].join("");',
      "TRUNCATE attachments",
      "TRUNCATE TABLE studio_images",
      "COPY attachments TO STDOUT",
      "LOCK TABLE attachments IN ACCESS EXCLUSIVE MODE",
      "SELECT 1 FROM spaces s, attachments a WHERE a.space_id = s.id",
      'const g = "uploads/*"; q(`DELETE FROM attachments`); /* fin */',
    ]) {
      expect(usesOldTables(code), code).toBe(true);
    }
  });

  it("ne déclenche ni sur l'URL, ni sur le dossier de route, ni sur la clé historique", () => {
    for (const code of [
      'fetch("/api/attachments/signed?key=x")',
      'const url = `/api/attachments/${key}`;',
      'import { GET } from "@/app/api/attachments/route";',
      'const key = `attachments/${runId}/file.png`;',
      'if (pathname.startsWith("/api/attachments/")) return;',
      'import { media } from "@/lib/db/schema";',
      "// import { attachments } from '@/lib/db/schema'",
      "/* FROM attachments */ const a = 1;",
    ]) {
      expect(usesOldTables(code), code).toBe(false);
    }
  });
});
