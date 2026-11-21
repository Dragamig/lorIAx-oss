import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..", "..");

describe("validateur divergent supprimé", () => {
  it("le fichier validate-action-config.ts n'existe plus", () => {
    expect(existsSync(path.join(SRC, "lib/automations/validate-action-config.ts"))).toBe(false);
  });

  it("plus aucun import de validate-action-config dans src", () => {
    const files = globSync("**/*.ts", { cwd: SRC }).filter((f) => !f.includes("__tests__"));
    const offenders = files.filter((f) =>
      readFileSync(path.join(SRC, f), "utf8").includes("automations/validate-action-config")
    );
    expect(offenders).toEqual([]);
  });
});
