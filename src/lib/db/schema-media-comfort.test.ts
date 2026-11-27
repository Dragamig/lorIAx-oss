import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { mediaSavedViews, mediaMultipartUploads } from "./schema-media-comfort";

const idx = (t: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(t).indexes.map((i) => ({
    unique: !!i.config.unique,
    cols: i.config.columns.map((c) => (c as { name: string }).name).join(","),
  }));

// L'édition open source n'embarque qu'une migration initiale : les migrations numérotées sont absentes.
const hasNumberedMigrations = fs.existsSync(path.join(process.cwd(), "src/lib/db/migrations/0072_media_whiteboard_trigger.sql"));

describe("schema-media-comfort", () => {
  it("est réexporté depuis schema.ts", () => {
    expect(schema.mediaSavedViews).toBe(mediaSavedViews);
    expect(schema.mediaMultipartUploads).toBe(mediaMultipartUploads);
  });

  it("media_saved_views : colonnes et unicité (user_id, name)", () => {
    const cols = getTableColumns(mediaSavedViews);
    for (const c of ["id", "organizationId", "userId", "name", "query", "shared", "createdAt"]) {
      expect(cols).toHaveProperty(c);
    }
    expect(idx(mediaSavedViews)).toContainEqual({ unique: true, cols: "user_id,name" });
  });

  it("media_multipart_uploads : colonnes et index (status, expires_at)", () => {
    const cols = getTableColumns(mediaMultipartUploads);
    for (const c of [
      "id", "organizationId", "userId", "spaceId", "folderId", "filename", "mimeType",
      "sizeBytes", "partSize", "s3UploadId", "storageKey", "status", "createdAt", "expiresAt",
    ]) {
      expect(cols).toHaveProperty(c);
    }
    expect(idx(mediaMultipartUploads)).toContainEqual({ unique: false, cols: "status,expires_at" });
  });

  it("cascade à la suppression de l'organisation et de l'utilisateur", () => {
    for (const t of [mediaSavedViews, mediaMultipartUploads]) {
      const fks = getTableConfig(t).foreignKeys.map((f) => {
        const r = f.reference();
        return `${r.columns.map((c) => c.name).join(",")}:${f.onDelete}`;
      });
      expect(fks).toContain("organization_id:cascade");
      expect(fks).toContain("user_id:cascade");
    }
  });

  it.skipIf(!hasNumberedMigrations)("la migration 0074 crée les deux tables de façon idempotente", () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), "src/lib/db/migrations/0074_media_saved_views_multipart.sql"),
      "utf8",
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS media_saved_views/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS media_multipart_uploads/);
    expect(sql).toMatch(/ON media_multipart_uploads \(status, expires_at\)/);
  });
});
