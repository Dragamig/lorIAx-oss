import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { media, mediaUsages } from "./schema-media";

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
});
