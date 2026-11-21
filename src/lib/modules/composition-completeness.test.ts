import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { getAllModuleManifests, getModuleManifests } from "./registry";
import { pathMatchesPattern } from "./owned-paths";
import { OPTIONAL_EXTENSION_SOURCES } from "@/components/editor/extensions/optional-extensions.config";

// Tout loriax-app (chemins relatifs) : des ownedPaths visent aussi assets/, scripts/, docs/.
const trackedFiles = execSync("git ls-files", {
  cwd: resolve(__dirname, "../../.."),
}).toString().split("\n").filter(Boolean);

describe("cohérence editorExtensions ↔ config", () => {
  it("chaque clé editorExtensions des manifestes a une source dans la config", () => {
    const known = new Set(OPTIONAL_EXTENSION_SOURCES.map((s) => s.key));
    for (const m of getModuleManifests()) {
      for (const key of m.editorExtensions ?? []) {
        expect(known.has(key), `clé ${key} (module ${m.id}) absente de OPTIONAL_EXTENSION_SOURCES`).toBe(true);
      }
    }
  });
  it("chaque source de config référence un module connu qui la déclare", () => {
    const byId = new Map(getAllModuleManifests().map((m) => [m.id, m] as const));
    for (const s of OPTIONAL_EXTENSION_SOURCES) {
      const m = byId.get(s.moduleId);
      expect(m, `module ${s.moduleId} inconnu`).toBeDefined();
      expect(m!.editorExtensions ?? [], `${s.key} non déclaré par ${s.moduleId}`).toContain(s.key);
    }
  });
});

describe("complétude ownedPaths", () => {
  it("chaque glob ownedPaths résout vers au moins un fichier suivi", () => {
    for (const m of getModuleManifests()) {
      for (const pat of m.ownedPaths ?? []) {
        const hit = trackedFiles.some((f) => pathMatchesPattern(f, pat));
        expect(hit, `ownedPaths mort: ${pat} (module ${m.id})`).toBe(true);
      }
    }
  });

  it("le fichier source de chaque extension est couvert par les ownedPaths de son module", () => {
    const byId = new Map(getAllModuleManifests().map((m) => [m.id, m] as const));
    // Les sources d'un module exclu du profil (edition oss : studiovideo) ont ete elaguees de l'arbre.
    const included = new Set(getModuleManifests().map((m) => m.id));
    for (const s of OPTIONAL_EXTENSION_SOURCES.filter((x) => included.has(x.moduleId))) {
      const m = byId.get(s.moduleId)!;
      // importPath relatif à extensions/ → chemin réel + extension .ts ou .tsx
      const base = `src/components/editor/extensions/${s.importPath.replace(/^\.\//, "")}`;
      const candidates = [`${base}.ts`, `${base}.tsx`];
      const realFile = candidates.find((c) => trackedFiles.includes(c));
      expect(realFile, `source introuvable pour ${s.key}: ${candidates.join(" | ")}`).toBeDefined();
      const covered = (m.ownedPaths ?? []).some((pat) => pathMatchesPattern(realFile!, pat));
      expect(covered, `${realFile} (extension ${s.key}) hors des ownedPaths de ${s.moduleId}`).toBe(true);
    }
  });
});
