/**
 * Schéma des modèles de présentation (lot 3, T1).
 *
 * Un modèle est une ligne `presentations` marquée `is_template`, rattachée à
 * l'organisation et sans espace. Ce fichier vérifie :
 *  (a) les colonnes ajoutées existent, sont nullables sauf `is_template`
 *      (NOT NULL DEFAULT false), et `space_id` devient nullable ;
 *  (b) la migration 0059 : voir presentations-schema.migration.test.ts ;
 *  (c) la contrainte CHECK `space_id IS NOT NULL OR is_template` existe à la
 *      fois dans le schéma Drizzle et dans la migration.
 *
 * Mutation (preuve de rouge) : retirer `.notNull().default(false)` de
 * `isTemplate` fait échouer le test (a) « isTemplate NOT NULL défaut faux » ;
 * retirer la clause CHECK du schéma fait échouer le test (c).
 */
import { describe, it, expect } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

const { presentations } = schema;
const config = getTableConfig(presentations);
const columnByName = (name: string) =>
  config.columns.find((c) => c.name === name);

const NEW_COLUMNS = [
  "organization_id",
  "is_template",
  "template_description",
  "template_origin",
  "template_seed_key",
  "template_hidden_at",
];

describe("schéma presentations : modèles (a) colonnes", () => {
  it("exporte presentations depuis @/lib/db/schema", () => {
    expect(presentations).toBeDefined();
    expect(config.name).toBe("presentations");
  });

  it("ajoute les six colonnes de modèle", () => {
    for (const name of NEW_COLUMNS) {
      expect(columnByName(name), `colonne ${name}`).toBeDefined();
    }
  });

  it("rend organization_id, description, origine, clé de semis et masquage nullables", () => {
    for (const name of NEW_COLUMNS.filter((n) => n !== "is_template")) {
      expect(columnByName(name)!.notNull, `${name} nullable`).toBe(false);
    }
  });

  it("is_template est NOT NULL avec défaut faux", () => {
    const col = columnByName("is_template")!;
    expect(col.notNull).toBe(true);
    expect(col.hasDefault).toBe(true);
    expect(col.default).toBe(false);
  });

  it("space_id devient nullable (un modèle n'a pas d'espace)", () => {
    expect(columnByName("space_id")!.notNull).toBe(false);
  });

  it("ajoute l'index unique partiel d'idempotence du semis", () => {
    const idx = config.indexes.find(
      (i) => i.config.name === "idx_presentations_template_seed"
    );
    expect(idx, "index idx_presentations_template_seed").toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.where).toBeDefined();
  });
});

describe("contrainte CHECK space_id ou is_template (c)", () => {
  it("est déclarée dans le schéma Drizzle", () => {
    const check = config.checks.find(
      (c) => c.name === "presentations_space_or_template_chk"
    );
    expect(check, "CHECK presentations_space_or_template_chk").toBeDefined();
    const rendered = new PgDialect().sqlToQuery(check!.value).sql;
    expect(rendered).toBe("space_id IS NOT NULL OR is_template");
  });
});
