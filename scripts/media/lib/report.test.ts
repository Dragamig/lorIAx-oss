import { describe, expect, it } from "vitest";
import { Report } from "./report";

describe("Report", () => {
  it("compte par type et par issue", () => {
    const r = new Report({ script: "t", apply: false });
    r.add("image", "rewritten", { table: "user_database_rows", id: "1" });
    r.add("image", "rewritten", { table: "user_database_rows", id: "2" });
    r.add("image", "key_not_found", { table: "user_database_rows", id: "3" });
    r.add("attachment", "orphan", { table: "user_database_rows", id: "4" });
    const s = r.summary();
    expect(s.image.rewritten).toBe(2);
    expect(s.image.key_not_found).toBe(1);
    expect(s.attachment.orphan).toBe(1);
    expect(s.attachment.rewritten).toBe(0);
  });

  it("liste à examiner : seulement les issues non silencieuses", () => {
    const r = new Report();
    r.add("image", "rewritten", { table: "t", id: "1" });
    r.add("image", "ambiguous", { table: "t", id: "2", detail: "clé partagée" });
    const json = r.toJSON() as { attention: unknown[]; total: number };
    expect(json.attention).toHaveLength(1);
    expect(json.total).toBe(2);
  });

  it("le texte ne contient aucun tiret cadratin ni demi-cadratin", () => {
    const r = new Report({ script: "rewrite-cells", apply: true, target: "localhost:5432/loriax_test_1c" });
    r.add("image", "orphan", { table: "t", id: "1", detail: "sans média" });
    const text = r.toText();
    expect(text).not.toMatch(/[\u2013\u2014]/);
    expect(new Report().toText()).not.toMatch(/[\u2013\u2014]/);
  });
});
