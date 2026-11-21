/**
 * Garde-fou anti-régression — homonymie des helpers d'accès document.
 *
 * `@/lib/collab/auth-ws` exposait un `checkDocumentEditAccess` homonyme du
 * helper sûr de `@/lib/auth/check-access`, mais sans cloisonnement multi-tenant
 * et avec bypass admin inconditionnel : un simple changement d'import suffisait
 * à ouvrir un trou d'accès. Le helper collab s'appelle désormais
 * `checkCollabDocumentEditAccess` et aucun nom ne se recoupe plus.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/db", () => ({ db: {} }));

describe("helpers d'accès document — pas d'homonymie", () => {
  it("le module collab n'exporte plus checkDocumentEditAccess", async () => {
    const collab = await import("@/lib/collab/auth-ws");
    expect(collab).toHaveProperty("checkCollabDocumentEditAccess");
    expect(collab).not.toHaveProperty("checkDocumentEditAccess");
  });

  it("aucune route API n'importe la variante collab", () => {
    const apiDir = path.resolve(__dirname, "../app/api");
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
        const src = readFileSync(full, "utf8");
        if (/from\s+["']@\/lib\/collab\/auth-ws["']/.test(src)) offenders.push(full);
      }
    };
    walk(apiDir);

    expect(offenders).toEqual([]);
  });
});
