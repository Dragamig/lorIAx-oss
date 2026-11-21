import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { getTableName, getTableColumns, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}


const DATA_IDENTS = [
  "userDatabaseRows",
  "userDatabaseColumns",
  "userDatabaseViews",
  "userDatabaseAutomations",
  "userDatabaseAutomationRuns",
  "automations",
  "automationRuns",
];
const DATA_SQL = "user_database_(?:rows|columns|views|automations|automation_runs)";

/** Écritures visant une table de données des Bases : appel Drizzle (nom nu, `schema.`, alias d'import) ou SQL brut. */
export function findDataWrites(code: string): string[] {
  const names = new Set(DATA_IDENTS);
  for (const m of code.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const spec of m[1].split(",")) {
      const a = spec.trim().match(/^(\w+)\s+as\s+(\w+)$/);
      if (a && DATA_IDENTS.includes(a[1])) names.add(a[2]);
    }
  }
  for (const m of code.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\w+\.)?(\w+)\s*;/g)) {
    if (names.has(m[2])) names.add(m[1]);
  }
  const alt = [...names].join("|");
  const found: string[] = [];
  const call = new RegExp(`\\.?\\b(?:insert|update|delete)\\s*\\(\\s*(?:\\w+\\.)?(?:${alt})\\b`, "g");
  for (const m of code.matchAll(call)) found.push(m[0]);
  const raw = new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+(?:ONLY\\s+)?(?:\\w+\\.)?"?${DATA_SQL}\\b`, "gi");
  for (const m of code.matchAll(raw)) found.push(m[0]);
  return found;
}

/** Import (alias, relatif ou dynamique) de src/lib/crm ou src/components/crm. */
export function findCrmImports(code: string, file: string): string[] {
  const found: string[] = [];
  const forbidden = [join(ROOT, "src/lib/crm"), join(ROOT, "src/components/crm")];
  for (const m of code.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["']([^"']+)["']/g)) {
    const spec = m[1];
    const abs = spec.startsWith("@/")
      ? join(ROOT, "src", spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(file), spec)
        : null;
    if (abs && forbidden.some((f) => abs === f || abs.startsWith(f + "/"))) found.push(spec);
  }
  return found;
}

const tables: PgTable[] = [];
for (const v of Object.values(schema) as unknown[]) if (is(v, PgTable)) tables.push(v);
const tableNames = tables.map((t) => getTableName(t));

describe("module CRM : aucune donnée propre", () => {
  it("le schéma Drizzle exporté ne contient aucune table crm_ autre que crm_connections", () => {
    expect(tableNames).toContain("crm_connections");
    expect(tableNames.filter((n) => n.startsWith("crm_"))).toEqual(["crm_connections"]);
  });

  it("crm_connections ne porte que des colonnes de configuration", () => {
    const table = tables.find((t) => getTableName(t) === "crm_connections")!;
    const names = Object.values(getTableColumns(table)).map((c) => c.name).sort();
    expect(names).toEqual(
      [
        "organization_id",
        "enabled",
        "contacts_database_id",
        "deals_database_id",
        "interactions_database_id",
        "created_database_ids",
        "field_map",
        "created_at",
        "updated_at",
        "updated_by",
      ].sort(),
    );
  });

  it("aucun fichier de src/lib/crm ni src/app/api/crm n'écrit dans une table de données des Bases (Drizzle, schema., alias, SQL brut)", () => {
    const files = [...walk(join(ROOT, "src/lib/crm")), ...walk(join(ROOT, "src/app/api/crm"))];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => findDataWrites(readFileSync(f, "utf8")).length > 0);
    expect(offenders).toEqual([]);
  });

  it("le détecteur d'écritures reconnaît chaque motif (cas positifs en mémoire)", () => {
    const positives = [
      "await tx.insert(userDatabaseRows).values(x)",
      "db.update(\n  userDatabaseRows\n)",
      "db.delete(userDatabaseRows)",
      "db.insert(schema.userDatabaseRows).values(x)",
      "import { userDatabaseRows as rows } from '@/lib/db/schema';\ndb.update(rows).set(y)",
      "const R = schema.userDatabaseRows;\ndb.delete(R)",
      "db.update(userDatabaseColumns).set(x)",
      "db.insert(userDatabaseViews).values(x)",
      "db.delete(userDatabaseAutomations)",
      "db.update(automations).set(x)",
      "db.execute(sql`UPDATE user_database_rows SET cells = '{}'`)",
      "pool.query('DELETE FROM user_database_columns')",
      "pool.query('insert into public.user_database_views values (1)')",
      "pool.query('TRUNCATE TABLE user_database_automations')",
    ];
    for (const code of positives) expect(findDataWrites(code), code).not.toHaveLength(0);
    const negatives = [
      "db.select().from(userDatabaseColumns).where(x)",
      "db.update(crmConnections).set(x)",
      "db.execute(sql`SELECT * FROM user_database_rows`)",
    ];
    for (const code of negatives) expect(findDataWrites(code), code).toHaveLength(0);
  });

  it("aucun fichier de src/components/bases ni src/lib/databases n'importe src/lib/crm ou src/components/crm (alias ou relatif)", () => {
    const files = [...walk(join(ROOT, "src/components/bases")), ...walk(join(ROOT, "src/lib/databases"))];
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => findCrmImports(readFileSync(f, "utf8"), f).length > 0);
    expect(offenders).toEqual([]);
  });

  it("le détecteur d'imports reconnaît chaque motif (cas positifs en mémoire)", () => {
    const f = join(ROOT, "src/lib/databases/x.ts");
    const g = join(ROOT, "src/components/bases/deep/y.tsx");
    const positives: [string, string][] = [
      ['import { a } from "@/lib/crm/access";', f],
      ['import a from "@/components/crm/panel";', f],
      ['const m = await import("@/lib/crm");', f],
      ['import { a } from "../crm/access";', f],
      ['import { a } from "../../../lib/crm";', g],
      ['import { a } from "../../crm/x";', g],
      ["import b from '../crm'", f],
    ];
    for (const [code, file] of positives) expect(findCrmImports(code, file), code).not.toHaveLength(0);
    expect(findCrmImports('import { a } from "./crm-like";', f)).toHaveLength(0);
    expect(findCrmImports('import { a } from "@/lib/crmx/y";', f)).toHaveLength(0);
  });

  it("aucune table crm_contacts, crm_deals ni crm_interactions (schéma et SQL de migration)", () => {
    for (const forbidden of ["crm_contacts", "crm_deals", "crm_interactions"]) {
      expect(tableNames).not.toContain(forbidden);
    }
    const dir = join(ROOT, "src/lib/db/migrations");
    const sql = readdirSync(dir)
      .filter((n) => n.endsWith(".sql"))
      .map((n) => readFileSync(join(dir, n), "utf8"))
      .join("\n");
    expect(sql).not.toMatch(/crm_(contacts|deals|interactions)\b/);
    const creates = [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+"?(crm_[a-z_]+)"?/gi)].map((m) => m[1]);
    expect(new Set(creates)).toEqual(new Set(["crm_connections"]));
  });
});
