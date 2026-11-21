import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { CLIENT_TABLES } from "@/lib/backup/tables";

const root = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("sauvegarde : CLIENT_TABLES", () => {
  it("contient les cinq tables média et plus attachments", () => {
    for (const t of ["media", "media_folders", "media_tags", "media_tag_links", "media_usages"]) {
      expect(CLIENT_TABLES).toContain(t);
    }
    expect(CLIENT_TABLES).not.toContain("attachments");
  });
});

describe("remise à zéro : purge.ts", () => {
  const src = read("src/lib/setup/purge.ts");
  const at = (t: string) => src.indexOf(`DELETE FROM ${t}\``);

  it("supprime les cinq tables média, enfants d'abord", () => {
    for (const t of ["media_usages", "media_tag_links", "media_tags", "media", "media_folders"]) {
      expect(at(t), t).toBeGreaterThan(-1);
    }
    expect(at("media_usages")).toBeLessThan(at("media"));
    expect(at("media_tag_links")).toBeLessThan(at("media"));
    expect(at("media_tag_links")).toBeLessThan(at("media_tags"));
    expect(at("media")).toBeLessThan(at("media_folders"));
    expect(src).not.toContain("DELETE FROM attachments");
  });

  it("n'omet aucun DELETE FROM de la liste d'origine", () => {
    for (const t of ["documents", "spaces", "users", "templates", "public_shares"]) {
      expect(at(t), t).toBeGreaterThan(-1);
    }
  });
});

describe("suppression d'un compte : admin/users", () => {
  it("réaffecte uploaded_by de media, plus attachments ni studio_images", () => {
    const src = read("src/app/api/admin/users/route.ts");
    expect(src).toContain('["media", "uploaded_by"]');
    expect(src).not.toContain('["attachments", "uploaded_by"]');
    expect(src).not.toContain('["studio_images", "created_by"]');
  });

  it("nomme les espaces archivés sans tiret typographique", () => {
    const src = read("src/app/api/admin/users/route.ts");
    const line = src.split("\n").find((l) => l.includes("`Archive ${archiveLabel}")) ?? "";
    expect(line).not.toBe("");
    expect(line).not.toMatch(/[\u2013\u2014]/);
  });
});

describe("restauration : sauvegarde 1.204.x", () => {
  it("passe par la liste filtrée de pg_restore (-L), sans attachments", () => {
    const src = read("src/app/api/admin/backups/restore/route.ts");
    expect(src).toContain("filterRestoreToc");
    expect(src).toContain('"-L"');
    expect(src).toContain('"-l"');
  });
});
