import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeTarget, parseMode, requireDatabaseUrl, resolveByStorageKey, writeBackup, assertTargetAllowed, databaseName } from "./plan";

describe("parseMode", () => {
  it("simulation par défaut", () => {
    expect(parseMode([]).apply).toBe(false);
  });
  it("--apply active l'écriture", () => {
    expect(parseMode(["--apply"]).apply).toBe(true);
  });
  it("--dry-run reste en simulation", () => {
    expect(parseMode(["--dry-run"]).apply).toBe(false);
  });
  it("refuse une valeur en ligne pour --apply et --dry-run", () => {
    expect(() => parseMode(["--apply=false"])).toThrow(/Usage/);
    expect(() => parseMode(["--apply=true"])).toThrow(/Usage/);
    expect(() => parseMode(["--dry-run=1"])).toThrow(/Usage/);
  });
  it("--apply et --dry-run ensemble : erreur", () => {
    expect(() => parseMode(["--apply", "--dry-run"])).toThrow(/Usage/);
    expect(() => parseMode(["--dry-run", "--apply"])).toThrow(/Usage/);
  });
  it("lit --confirm-db", () => {
    expect(parseMode(["--confirm-db=loriax_x"]).confirmDb).toBe("loriax_x");
    expect(parseMode(["--confirm-db", "loriax_x"]).confirmDb).toBe("loriax_x");
  });
  it("lit limit, org et report", () => {
    const m = parseMode(["--limit", "5", "--org=abc", "--report", "x.json"]);
    expect(m).toMatchObject({ limit: 5, org: "abc", reportPath: "x.json", apply: false });
  });
  it("option inconnue ou valeur invalide : erreur d'usage", () => {
    expect(() => parseMode(["--force"])).toThrow(/Usage/);
    expect(() => parseMode(["--limit", "0"])).toThrow(/Usage/);
    expect(() => parseMode(["--limit"])).toThrow(/Usage/);
  });
});

describe("requireDatabaseUrl", () => {
  it("refuse sans DATABASE_URL", () => {
    expect(() => requireDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
  it("retourne l'URL fournie et la décrit sans mot de passe", () => {
    const url = requireDatabaseUrl({ DATABASE_URL: "postgres://u:secret@db:5432/loriax_test_1c" });
    const d = describeTarget(url);
    expect(d).toBe("db:5432/loriax_test_1c");
    expect(d).not.toContain("secret");
  });
});

describe("assertTargetAllowed", () => {
  const sim = { apply: false, reportPath: "x" };
  it("simulation : aucune confirmation exigée", () => {
    expect(() => assertTargetAllowed("postgres://u:p@h/loriax_prod2", sim)).not.toThrow();
  });
  it("--apply exige --confirm-db égal au nom de la base", () => {
    const url = "postgres://u:p@h:5432/loriax_test_1c";
    expect(() => assertTargetAllowed(url, { ...sim, apply: true })).toThrow(/confirm-db/);
    expect(() => assertTargetAllowed(url, { ...sim, apply: true, confirmDb: "autre" })).toThrow(/confirm-db/);
    expect(() => assertTargetAllowed(url, { ...sim, apply: true, confirmDb: "loriax_test_1c" })).not.toThrow();
  });
  it("base nommée loriax refusée, même en simulation, sauf --confirm-db=loriax", () => {
    const url = "postgres://u:p@h/loriax";
    expect(() => assertTargetAllowed(url, sim)).toThrow(/loriax/);
    expect(() => assertTargetAllowed(url, { ...sim, apply: true, confirmDb: "loriax_x" })).toThrow();
    expect(() => assertTargetAllowed(url, sim && { ...sim, confirmDb: "loriax" })).not.toThrow();
    expect(() => assertTargetAllowed(url, { ...sim, apply: true, confirmDb: "loriax" })).not.toThrow();
  });
  it("loriax_test n'est pas la base loriax", () => {
    expect(() => assertTargetAllowed("postgres://u:p@h/loriax_test", sim)).not.toThrow();
  });
  it("databaseName lit le nom sans paramètres", () => {
    expect(databaseName("postgres://u:p@h/db1?sslmode=require")).toBe("db1");
  });
});

describe("writeBackup", () => {
  it("écrit les valeurs d'origine", () => {
    const dir = mkdtempSync(join(tmpdir(), "media-rewrite-"));
    try {
      const path = writeBackup(dir, "cells", [{ id: "r1", before: { a: 1 } }]);
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      expect(parsed.entries).toEqual([{ id: "r1", before: { a: 1 } }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveByStorageKey", () => {
  const a = { id: "1", storageKey: "k1" };
  const b = { id: "2", storageKey: "k2" };
  it("clé unique : found", () => {
    expect(resolveByStorageKey("k1", [a, b])).toEqual({ status: "found", media: a });
  });
  it("clé absente : not_found", () => {
    expect(resolveByStorageKey("zz", [a, b])).toEqual({ status: "not_found" });
  });
  it("deux candidats : ambiguous", () => {
    expect(resolveByStorageKey("k1", [a, { id: "3", storageKey: "k1" }])).toEqual({ status: "ambiguous" });
  });
});
