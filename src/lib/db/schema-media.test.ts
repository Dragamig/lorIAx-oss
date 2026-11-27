import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { media, mediaUsages, mediaVersions } from "./schema-media";

// L'édition open source n'embarque qu'une migration initiale : les migrations numérotées sont absentes.
const hasNumberedMigrations = fs.existsSync(path.join(process.cwd(), "src/lib/db/migrations/0072_media_whiteboard_trigger.sql"));

describe("schema-media", () => {
  it("réexporte schema-media depuis schema.ts", () => {
    expect(schema.media).toBeDefined();
    expect(schema.mediaFolders).toBeDefined();
    expect(schema.mediaTags).toBeDefined();
    expect(schema.mediaTagLinks).toBeDefined();
    expect(schema.mediaUsages).toBeDefined();
  });

  it("liste les fichiers schema-*.ts et vérifie que chacun est réexporté", () => {
    const dir = path.join(process.cwd(), "src/lib/db");
    const text = fs.readFileSync(path.join(dir, "schema.ts"), "utf8");
    const missing = fs
      .readdirSync(dir)
      .filter((f) => /^schema-.*\.ts$/.test(f) && !f.endsWith(".test.ts"))
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((n) => !new RegExp(`export \\*\\s+from\\s+["']\\./${n}["']`).test(text));
    expect(missing).toEqual([]);
  });

  it("media porte les colonnes de la spec", () => {
    const cols = getTableColumns(media);
    for (const c of [
      "id", "organizationId", "spaceId", "folderId", "documentId", "filename", "title",
      "altText", "description", "mimeType", "kind", "origin", "sizeBytes", "storageKey",
      "checksumSha256", "width", "height", "pageCount", "thumbnailKey", "currentVersion",
      "uploadedBy", "createdAt", "updatedAt", "deletedAt", "deletedBy",
    ]) {
      expect(cols).toHaveProperty(c);
    }
    expect(cols.spaceId.notNull).toBe(false);
    expect(cols.organizationId.notNull).toBe(true);
  });

  it("media_usages porte source et context", () => {
    const cols = getTableColumns(mediaUsages);
    expect(cols).toHaveProperty("source");
    expect(cols).toHaveProperty("context");
    expect(cols).toHaveProperty("spaceId");
    expect(cols.source.default).toBe("content");
  });

  it("cible d'usage whiteboard et déclencheur media_uploaded", () => {
    expect(schema.mediaUsageTargetEnum.enumValues).toContain("whiteboard");
    expect(schema.automationTriggerEnum.enumValues).toContain("media_uploaded");
  });

  it.skipIf(!hasNumberedMigrations)("la migration 0072 ajoute les deux valeurs d'enum", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "src/lib/db/migrations/0072_media_whiteboard_trigger.sql"),
      "utf8",
    );
    expect(sql).toMatch(/media_usage_target[\s\S]*ADD VALUE IF NOT EXISTS 'whiteboard'/);
    expect(sql).toMatch(/database_automation_trigger[\s\S]*ADD VALUE IF NOT EXISTS 'media_uploaded'/);
  });

  it("media_versions porte les colonnes et les index uniques", () => {
    expect(schema.mediaVersions).toBeDefined();
    const cols = getTableColumns(mediaVersions);
    for (const c of [
      "id", "mediaId", "version", "storageKey", "thumbnailKey", "filename", "mimeType",
      "sizeBytes", "checksumSha256", "width", "height", "pageCount", "createdBy", "createdAt",
      "comment", "restoredFrom",
    ]) {
      expect(cols).toHaveProperty(c);
    }
    const cfg = getTableConfig(mediaVersions);
    const uniques = cfg.indexes.filter((i) => i.config.unique);
    const byCols = uniques.map((i) => i.config.columns.map((c) => (c as { name: string }).name).join(","));
    expect(byCols).toContain("media_id,version");
    expect(byCols).toContain("storage_key");
  });

  it.skipIf(!hasNumberedMigrations)("la migration 0073 est idempotente", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "src/lib/db/migrations/0073_media_versions.sql"),
      "utf8",
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS media_versions/);
    expect(sql).toMatch(/INSERT INTO media_versions[\s\S]*FROM media[\s\S]*ON CONFLICT DO NOTHING/);
  });
});
