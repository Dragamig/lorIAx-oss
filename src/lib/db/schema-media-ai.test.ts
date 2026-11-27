import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { mediaTexts, mediaEmbeddings, mediaAiSettings } from "./schema-media-ai";

const idx = (t: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(t).indexes.map((i) => ({
    unique: !!i.config.unique,
    cols: i.config.columns.map((c) => (c as { name: string }).name).join(","),
  }));
const fks = (t: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(t).foreignKeys.map((f) => {
    const r = f.reference();
    return `${r.columns.map((c) => c.name).join(",")}:${f.onDelete}`;
  });
// L'édition open source n'embarque qu'une migration initiale : les migrations numérotées sont absentes.
const migrationPath = path.join(process.cwd(), "src/lib/db/migrations/0075_media_ai_index.sql");
const hasNumberedMigrations = fs.existsSync(migrationPath);
const sqlText = hasNumberedMigrations ? fs.readFileSync(migrationPath, "utf8") : "";

describe("schema-media-ai", () => {
  it("est réexporté depuis schema.ts", () => {
    expect(schema.mediaTexts).toBe(mediaTexts);
    expect(schema.mediaEmbeddings).toBe(mediaEmbeddings);
    expect(schema.mediaAiSettings).toBe(mediaAiSettings);
  });

  it("media_texts : media_id unique, cascade, colonnes de file", () => {
    const cols = getTableColumns(mediaTexts);
    for (const c of ["status", "reason", "source", "text", "textChars", "version", "attempts", "nextAttemptAt", "lockedAt", "indexedAt"]) {
      expect(cols).toHaveProperty(c);
    }
    expect(getTableConfig(mediaTexts).uniqueConstraints.map((u) => u.columns.map((c) => c.name).join(","))).toContain("media_id");
    expect(fks(mediaTexts)).toContain("media_id:cascade");
    expect(fks(mediaTexts)).toContain("organization_id:cascade");
  });

  it("media_embeddings : unique (media_id, chunk_index), index organization_id, cascade", () => {
    expect(idx(mediaEmbeddings)).toContainEqual({ unique: true, cols: "media_id,chunk_index" });
    expect(idx(mediaEmbeddings)).toContainEqual({ unique: false, cols: "organization_id" });
    expect(fks(mediaEmbeddings)).toContain("media_id:cascade");
    expect(fks(mediaEmbeddings)).toContain("organization_id:cascade");
  });

  it.skipIf(!hasNumberedMigrations)("media_embeddings : clé étrangère vers media_texts(media_id) avec cascade", () => {
    const refs = getTableConfig(mediaEmbeddings).foreignKeys.map((f) => {
      const r = f.reference();
      return `${r.columns.map((c) => c.name)}->${getTableConfig(r.foreignTable).name}.${r.foreignColumns.map((c) => c.name)}:${f.onDelete}`;
    });
    expect(refs).toContain("media_id->media_texts.media_id:cascade");
    expect(sqlText).toMatch(/FOREIGN KEY \(media_id\) REFERENCES media_texts \(media_id\) ON DELETE CASCADE/);
  });

  it("media_ai_settings : interrupteurs faux par défaut, cascade organisation", () => {
    expect(getTableColumns(mediaAiSettings).indexEnabled.default).toBe(false);
    expect(getTableColumns(mediaAiSettings).transcribeEnabled.default).toBe(false);
    expect(fks(mediaAiSettings)).toContain("organization_id:cascade");
  });

  it.skipIf(!hasNumberedMigrations)("la migration 0075 : cascades, index de file partiel, aucune colonne vector", () => {
    expect(sqlText.match(/ON DELETE CASCADE/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sqlText).toMatch(/idx_media_texts_queue ON media_texts \(next_attempt_at\) WHERE status = 'pending'/);
    expect(sqlText).toMatch(/index_enabled boolean NOT NULL DEFAULT false/);
    expect(sqlText).toMatch(/transcribe_enabled boolean NOT NULL DEFAULT false/);
    expect(sqlText.toLowerCase()).not.toMatch(/vector\s*\(/);
  });
});
