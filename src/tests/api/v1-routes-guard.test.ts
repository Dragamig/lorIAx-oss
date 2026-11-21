import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return routes(p);
    return n === "route.ts" ? [p] : [];
  });
}

describe("routes API v1", () => {
  const all = routes(join(process.cwd(), "src/app/api/v1"));

  it("en énumère au moins une", () => {
    expect(all.length).toBeGreaterThan(0);
  });

  it.each(all)("%s passe par authenticateApiRequest (garde api_access)", (file) => {
    expect(readFileSync(file, "utf8")).toMatch(/authenticateApiRequest\(/);
  });
});

describe("garde d'authentification v1", () => {
  it("vérifie api_access pour les clés d'API", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/api/auth-api.ts"), "utf8");
    expect(src).toMatch(/entitlements\.hasFeature\(\s*"api_access"\s*\)/);
  });
});
