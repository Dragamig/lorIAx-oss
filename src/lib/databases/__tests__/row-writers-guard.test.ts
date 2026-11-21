/**
 * Garde : toute écriture de cellules de lignes passe par row-writes.ts pour que
 * l'inverse des relations jumelées reste synchronisé. Les fichiers listés
 * écrivent directement dans user_database_rows : ils sont connus et justifiés.
 * Un nouvel écrivain fait échouer ce test : le router par row-writes.ts, ou
 * l'ajouter ici avec sa raison.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "../../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const WRITE_RE =
  /\.(insert|update|delete)\(\s*(schema\.)?userDatabaseRows\s*\)|\bUPDATE\s+(ONLY\s+)?"?user_database_rows\b|\bINSERT\s+INTO\s+"?user_database_rows\b|\bDELETE\s+FROM\s+(ONLY\s+)?"?user_database_rows\b/i;

/** Écrivains directs connus (chemins relatifs à src/) et raison. */
const KNOWN_WRITERS: Record<string, string> = {
  "lib/databases/row-writes.ts": "couche d'écriture unique, synchronise l'inverse",
  "lib/databases/row-batch.ts": "opérations en lot (suppression, restauration, duplication, réordonnancement) : synchronisent l'inverse via syncRelationInverses",
  "lib/databases/relation-sync.ts": "écriture SQL de l'inverse des relations jumelées (après contrôle de réciprocité)",
  "lib/databases/relation-columns.ts": "purge de la clé d'une colonne relation supprimée (cellules uniquement, historique ignoré par SKIP_ROW_HISTORY)",
  "lib/setup/purge.ts": "purge d'installation : vide les tables, historique ignoré par SKIP_ROW_HISTORY",
  "lib/integrations/sync-orchestrator.ts":
    "intégrations externes (Airtable/Notion) : NE gère PAS le jumelage, une colonne relation jumelée mappée n'est pas synchronisée ; pose le contexte source sync",
  "app/api/databases/route.ts": "création d'une base : lignes initiales sans relation",
  "app/api/databases/[databaseId]/columns/route.ts": "purge de la clé d'une colonne supprimée",
  "app/api/databases/[databaseId]/duplicate/route.ts":
    "copie de base : insère les lignes du clone ; les relations copiées ne sont pas jumelées (inverseColumnId retiré), les lignes d'origine ne sont pas modifiées",
  "app/api/public/views/[token]/submit/route.ts": "formulaire public, colonnes relation exclues",
};

describe("écrivains de user_database_rows", () => {
  const writers = walk(SRC)
    .filter((f) => WRITE_RE.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f))
    .sort();

  it("aucun écrivain inconnu hors liste blanche", () => {
    const unknown = writers.filter((f) => !(f in KNOWN_WRITERS));
    expect(unknown, "Passer par row-writes.ts ou justifier dans KNOWN_WRITERS").toEqual([]);
  });

  it("sync-orchestrator écrit en direct et ne synchronise pas les relations (limite assumée)", () => {
    const src = readFileSync(join(SRC, "lib/integrations/sync-orchestrator.ts"), "utf8");
    expect(WRITE_RE.test(src)).toBe(true);
    expect(src).not.toContain("syncRelationInverses");
    expect(src).not.toContain("row-writes");
  });

  it("la liste blanche ne contient pas de fichier qui n'écrit plus", () => {
    const stale = Object.keys(KNOWN_WRITERS).filter((f) => !writers.includes(f));
    expect(stale).toEqual([]);
  });
});

describe("voies d'écriture routées par row-writes", () => {
  const read = (f: string) => readFileSync(join(SRC, f), "utf8");
  it("la route rows supprime via deleteDatabaseRow", () => {
    const src = read("app/api/databases/[databaseId]/rows/route.ts");
    expect(src).toContain("deleteDatabaseRow");
    expect(WRITE_RE.test(src)).toBe(false);
  });
  it("la duplication retire inverseColumnId des colonnes clonées", () => {
    expect(read("app/api/databases/[databaseId]/duplicate/route.ts")).toContain("cloneColumnConfig");
  });
  it("create_row et update_row du moteur écrivent via row-writes", () => {
    for (const f of ["lib/automations/actions/create-row.ts", "lib/automations/actions/update-row.ts"]) {
      const src = read(f);
      expect(src).toContain("@/lib/databases/row-writes");
      expect(WRITE_RE.test(src)).toBe(false);
    }
  });
});

describe("contexte d'historique", () => {
  const read = (f: string) => readFileSync(join(SRC, f), "utf8");
  const SKIP = /SKIP_ROW_HISTORY/;
  const EXPECTED_CONTEXT: Record<string, RegExp> = {
    "lib/databases/row-writes.ts": /setRowChangeContext\(/,
    "lib/databases/row-batch.ts": /setRowChangeContext\(/,
    "lib/databases/relation-sync.ts": /setRowChangeContext\(/,
    "app/api/public/views/[token]/submit/route.ts": /source:\s*"public_form"/,
    "lib/integrations/sync-orchestrator.ts": /source:\s*"sync"/,
    "app/api/databases/route.ts": SKIP,
    "app/api/databases/[databaseId]/duplicate/route.ts": SKIP,
    "app/api/databases/[databaseId]/columns/route.ts": SKIP,
    "lib/databases/relation-columns.ts": SKIP,
    "lib/setup/purge.ts": SKIP,
  };

  it("tout écrivain connu pose son contexte (ou son skip)", () => {
    for (const f of Object.keys(KNOWN_WRITERS)) {
      expect(read(f), f).toMatch(EXPECTED_CONTEXT[f] ?? /$^/);
    }
  });

  it("tout appelant d'un helper d'écriture importe row-change-context ou row-request-context", () => {
    const HELPERS =
      /\b(createDatabaseRow|mergeDatabaseRowCells|fillEmptyRowCells|deleteDatabaseRow|deleteDatabaseRows|restoreDatabaseRows|duplicateDatabaseRows)\(/;
    const offenders = walk(SRC)
      .map((f) => relative(SRC, f))
      .filter((f) => !f.startsWith("lib/databases/row-"))
      .filter((f) => HELPERS.test(read(f)))
      .filter((f) => !/row-change-context|row-request-context/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("aucun écrivain n'est ajouté sans entrée dans EXPECTED_CONTEXT", () => {
    expect(Object.keys(EXPECTED_CONTEXT).sort()).toEqual(Object.keys(KNOWN_WRITERS).sort());
  });
});
