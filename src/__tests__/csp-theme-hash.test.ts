import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Garde-fou anti-dérive : le <script> inline de détection du thème dans
 * src/app/[locale]/layout.tsx n'est pas noncé par Next.js (réservé à ses propres
 * <script>). Sous `strict-dynamic`, il n'est autorisé que par son hash
 * SHA-256, déclaré en dur dans src/proxy.ts (THEME_SCRIPT_HASH).
 *
 * Si quelqu'un modifie le script de thème sans régénérer le hash, le
 * navigateur bloquera le script en prod (flash de thème + thème clair forcé).
 * Ce test recalcule le hash depuis layout.tsx et vérifie qu'il est bien
 * présent dans proxy.ts.
 */
describe("CSP — hash du script de thème", () => {
  const root = path.resolve(__dirname, "..");

  it("le hash du script de thème de layout.tsx figure dans la CSP de proxy.ts", () => {
    const layout = readFileSync(path.join(root, "app/[locale]/layout.tsx"), "utf8");
    const middleware = readFileSync(path.join(root, "proxy.ts"), "utf8");

    // Extraire le contenu exact du script inline (dangerouslySetInnerHTML)
    const match = layout.match(/__html: `([^`]*)`/);
    expect(match, "script de thème introuvable dans layout.tsx").toBeTruthy();
    const script = match![1];

    const hash = "sha256-" + createHash("sha256").update(script, "utf8").digest("base64");

    expect(
      middleware.includes(hash),
      `Le hash du script de thème a changé. Mettre à jour THEME_SCRIPT_HASH dans middleware.ts avec : '${hash}'`,
    ).toBe(true);
  });
});
