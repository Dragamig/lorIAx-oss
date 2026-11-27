import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("schema reexports", () => {
  it("chaque schema-*.ts est réexporté par schema.ts", () => {
    const dir = join(__dirname, "..");
    const schemaText = readFileSync(join(dir, "schema.ts"), "utf8");
    const files = readdirSync(dir).filter(
      (f) => /^schema-.*\.ts$/.test(f) && !f.includes(".test."),
    );
    expect(files.length).toBeGreaterThan(0);
    const missing = files
      .map((f) => f.replace(/\.ts$/, ""))
      .filter((n) => !schemaText.includes(`export * from "./${n}"`));
    expect(missing).toEqual([]);
  });

  it("la table ai_creation_proposals est exposée par schema.ts", async () => {
    const schema = await import("@/lib/db/schema");
    expect(schema.aiCreationProposals).toBeDefined();
  });
});
