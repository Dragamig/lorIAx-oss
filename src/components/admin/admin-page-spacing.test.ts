import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ADMIN_ROOT = join(process.cwd(), "src", "app", "[locale]", "(app)", "admin");

/**
 * Pages sans marge basse, et pourquoi.
 *
 * La marge appartient à chaque page, pas au conteneur de défilement de la
 * disposition : posée en surcouche, elle s'appliquait même aux écrans qui
 * gèrent leur propre défilement.
 */
const EXEMPT = new Map([
  ["page.tsx", "redirection seule, aucun rendu"],
  ["ai/logs/page.tsx", "vue deux colonnes pleine hauteur, défilement interne"],
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

describe("marge basse des pages d'administration", () => {
  const pages = walk(ADMIN_ROOT);

  it("couvre toutes les pages, sauf les dispenses documentées", () => {
    const missing = pages
      .map((file) => ({ file, rel: relative(ADMIN_ROOT, file) }))
      .filter(({ file, rel }) => !EXEMPT.has(rel) && !readFileSync(file, "utf8").includes("pb-24"))
      .map(({ rel }) => rel);
    expect(missing, "ajouter la marge basse à la racine de la page").toEqual([]);
  });

  it("aucune disposition ne la repose par dessus le conteneur de défilement", () => {
    const layouts = ["layout.tsx", "ai/layout.tsx", "emails/layout.tsx"];
    for (const rel of layouts) {
      const source = readFileSync(join(ADMIN_ROOT, rel), "utf8");
      expect(/overflow-y-auto[^"]*\bpb-\d/.test(source), `marge en surcouche dans ${rel}`).toBe(
        false
      );
    }
  });
});
