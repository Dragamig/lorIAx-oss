import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllModuleManifests } from "./registry";
import { INCLUDED_MODULE_IDS } from "./registry.generated";
import { pathMatchesPattern } from "./owned-paths";

const ROOT = resolve(__dirname, "../../..");
const CLOUD = /\/signup|register-org|admin\/license|admin\/organizations|admin\/telemetry|api\/org\/create|api\/user\/organizations|updates\/check/;

/** Explicit allowlist: file and reason. Anything else mentioning a cloud route outside the commercial module fails. */
const ALLOWED: Record<string, string> = {
  "src/app/[locale]/(auth)/register/page.tsx": "lien /signup affiché seulement si le slot client cloudSignup est fourni par le module commercial",
  "src/app/api/auth/register/route.ts": "commentaires seulement : la route du noyau renvoie needsOrg et mentionne la route cloud dans sa documentation",
  "src/lib/modules/registry.ts": "déclare les ownedPaths du module commercial",
};

describe("noyau sans lien cloud", () => {
  it("core_sources_have_no_dangling_cloud_links", () => {
    // Hors noyau : le module commercial, et tout module absent de la composition (ses fichiers sont
    // elagues de l'export, `git ls-files` les liste encore dans l'arbre de travail d'un export).
    const included = new Set<string>(INCLUDED_MODULE_IDS);
    const owned = getAllModuleManifests()
      .filter((m) => m.id === "commercial" || !included.has(m.id))
      .flatMap((m) => m.ownedPaths ?? []);
    const files = execSync("git ls-files src", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f))
      .filter((f) => !f.startsWith("src/tests/") && !f.startsWith("src/__tests__/"))
      .filter((f) => !owned.some((p) => pathMatchesPattern(f, p)));
    const offenders = files.filter((f) => {
      if (f in ALLOWED) return false;
      return CLOUD.test(readFileSync(resolve(ROOT, f), "utf8"));
    });
    expect(offenders).toEqual([]);
  });

  it("allowlist_entries_are_still_needed", () => {
    for (const f of Object.keys(ALLOWED)) {
      const txt = readFileSync(resolve(ROOT, f), "utf8");
      expect(CLOUD.test(txt), f).toBe(true);
    }
  });
});
