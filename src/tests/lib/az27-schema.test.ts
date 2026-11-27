import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { users, emailVerificationTokens } from "@/lib/db/schema";

describe("AZ-27 schema", () => {
  it("users porte email_verified_at nullable avec défaut base", () => {
    const col = getTableConfig(users).columns.find((c) => c.name === "email_verified_at");
    expect(col).toBeDefined();
    expect(col!.notNull).toBe(false);
    expect(col!.hasDefault).toBe(true);
  });

  it("emailVerificationTokens est exportée par schema.ts avec token_hash unique", () => {
    expect(emailVerificationTokens).toBeDefined();
    const col = getTableConfig(emailVerificationTokens).columns.find((c) => c.name === "token_hash");
    expect(col).toBeDefined();
    expect(col!.isUnique).toBe(true);
  });

  it("seules les deux routes de libre-service insèrent emailVerifiedAt NULL", () => {
    const root = path.resolve(__dirname, "../..");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "tests") continue;
          walk(full);
        } else if (entry.name.endsWith(".ts") && fs.readFileSync(full, "utf8").includes("emailVerifiedAt: null")) {
          found.push(path.relative(root, full).split(path.sep).join("/"));
        }
      }
    };
    walk(root);
    // register-org (inscription commerciale) est retiré de l'édition open source.
    const expected = ["app/api/auth/register/route.ts"];
    if (fs.existsSync(path.join(root, "app/api/auth/register-org/route.ts"))) {
      expected.unshift("app/api/auth/register-org/route.ts");
    }
    expect(found.sort()).toEqual(expected);
  });
});
