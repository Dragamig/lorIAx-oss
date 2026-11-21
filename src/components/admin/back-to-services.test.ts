import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ADMIN_ROOT = join(process.cwd(), "src", "app", "[locale]", "(app)", "admin");
const COMPONENT = join(process.cwd(), "src", "components", "admin", "back-to-services.tsx");
const SAVE_BAR = join(process.cwd(), "src", "components", "admin", "floating-save-button.tsx");

/** Échelle d'espacement Tailwind : 1 unité = 4 px. */
const SPACING_PX = 4;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".tsx") ? [full] : [];
  });
}

describe("BackToServices", () => {
  it("pointe vers la page unique des modules", () => {
    expect(readFileSync(COMPONENT, "utf8")).toContain('href="/admin/modules"');
  });

  it("garde une marge basse supérieure à la bande de couverture de la barre d'enregistrement", () => {
    const band = readFileSync(SAVE_BAR, "utf8").match(/before:h-(\d+)/);
    const margin = readFileSync(COMPONENT, "utf8").match(/\bmb-(\d+)\b/);
    expect(band, "bande de couverture introuvable dans AdminSaveBar").not.toBeNull();
    expect(margin, "marge basse introuvable dans BackToServices").not.toBeNull();
    // Sans cette marge, le lien de retour passe sous le bloc opaque de la barre.
    expect(Number(margin![1]) * SPACING_PX).toBeGreaterThan(Number(band![1]) * SPACING_PX);
  });

  it("aucune page d'administration ne réimplémente son propre lien de retour", () => {
    const offenders = walk(ADMIN_ROOT).filter((file) =>
      /Retour aux (services|modules)/.test(readFileSync(file, "utf8"))
    );
    expect(offenders, "utiliser <BackToServices /> plutôt qu'un lien maison").toEqual([]);
  });
});
