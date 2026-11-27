import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseClientProfile } from "../src/lib/modules/composition";
import { getAllModuleManifests } from "../src/lib/modules/registry";
import { computePrunable, rootFromArgs } from "./prune-modules";
import { rootFromArgs as compositionRootFromArgs } from "./generate-module-composition";

const ROOT = resolve(__dirname, "..");
const tracked = execSync("git ls-files", { cwd: ROOT }).toString().split("\n").filter(Boolean);
const load = (f: string) => parseClientProfile(JSON.parse(readFileSync(resolve(ROOT, f), "utf8")));

// L'export de l'édition publique retire du registre les modules exclus : cette garde est sans objet.
const hasStudiovideo = getAllModuleManifests().some((m) => m.id === "studiovideo");

describe("prune-modules (calcul pur, aucune suppression)", () => {
  it.skipIf(!hasStudiovideo)("prune_covers_owned_paths_outside_src", () => {
    // Liste fixe ajoutee a l'arbre suivi : dans un arbre deja elague (edition oss), ces fichiers n'existent plus.
    const known = [
      "assets/video-fonts/PlusJakartaSans-Bold.ttf",
      "docs/kb/06-studio-video.md",
      "scripts/media/rewrite-video-source-keys.ts",
    ];
    const pruned = computePrunable(load("clients/oss.json"), [...tracked, ...known]);
    expect(pruned).toContain("assets/video-fonts/PlusJakartaSans-Bold.ttf");
    expect(pruned).toContain("docs/kb/06-studio-video.md");
    expect(pruned).toContain("scripts/media/rewrite-video-source-keys.ts");
  });

  it("prune_modules_root_option_is_backward_compatible", () => {
    // Sans --root : le dossier du script, comme avant.
    expect(rootFromArgs(["--profile", "clients/oss.json"])).toBe(ROOT);
    expect(compositionRootFromArgs(["--all"])).toBe(ROOT);
    // Avec --root : le dossier demandé, résolu en absolu.
    expect(rootFromArgs(["--profile", "p.json", "--root", "/tmp/x"])).toBe("/tmp/x");
    expect(compositionRootFromArgs(["--root", "/tmp/y", "--all"])).toBe("/tmp/y");
    expect(() => rootFromArgs(["--root"])).toThrow(/--root/);
  });
});
