import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@/lib/db/schema";

describe("schema-mailing reexport", () => {
  it("is reexported from schema.ts", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/db/schema.ts"), "utf8");
    expect(src).toContain('export * from "./schema-mailing"');
  });

  it("exposes mailAccounts through schema", () => {
    expect(schema).toHaveProperty("mailAccounts");
  });

  it("exposes mailMessages through schema", () => {
    expect(schema).toHaveProperty("mailMessages");
  });
});
