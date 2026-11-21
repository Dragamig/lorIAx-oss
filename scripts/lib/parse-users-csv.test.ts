import { describe, it, expect } from "vitest";
import { parseUsersCsv } from "./parse-users-csv";

describe("parseUsersCsv", () => {
  it("parse des lignes valides", () => {
    const csv = "email,name,role\nalice@acme.fr,Alice,admin\nbob@acme.fr,Bob,editor";
    const r = parseUsersCsv(csv);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ email: "alice@acme.fr", name: "Alice", role: "admin" });
  });
  it("normalise l'email en minuscules et trim", () => {
    const csv = "email,name,role\n  ALICE@ACME.FR ,Alice,admin";
    expect(parseUsersCsv(csv).rows[0].email).toBe("alice@acme.fr");
  });
  it("signale une ligne sans email valide", () => {
    const csv = "email,name,role\npas-un-email,Bob,editor";
    const r = parseUsersCsv(csv);
    expect(r.rows).toHaveLength(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it("applique le rôle editor par défaut si absent", () => {
    const csv = "email,name,role\nalice@acme.fr,Alice,";
    expect(parseUsersCsv(csv).rows[0].role).toBe("editor");
  });
});
