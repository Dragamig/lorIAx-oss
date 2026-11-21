import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getAllModuleManifests, getModuleManifests } from "./registry";
import { parseClientProfile, resolveIncludedModules } from "./composition";
import { pathMatchesPattern } from "./owned-paths";

const raw = JSON.parse(readFileSync(resolve(__dirname, "../../../clients/oss.json"), "utf8"));

describe("profil oss", () => {
  it("oss_profile_parses", () => {
    const profile = parseClientProfile(raw);
    expect(profile.client).toBe("oss");
    expect(profile.exclude).toContain("studiovideo");
  });

  it("oss_profile_includes_all_modules_but_studiovideo", () => {
    const profile = parseClientProfile(raw);
    const expected = new Set(
      getAllModuleManifests().map((m) => m.id).filter((id) => !profile.exclude.includes(id)),
    );
    expect(expected.has("studiovideo")).toBe(false);
    expect(resolveIncludedModules(profile)).toEqual(expected);
  });

  it("studiovideo_owned_paths_cover_known_leftovers", () => {
    const owned = getAllModuleManifests().find((m) => m.id === "studiovideo")!.ownedPaths ?? [];
    const leftovers = [
      "src/components/editor/extensions/video-editor-modal.tsx",
      "src/tests/api/video-pexels-siloing.test.ts",
      "src/__tests__/lib/video-editor-page-org-scope.test.ts",
      "src/__tests__/lib/video-space-access.test.ts",
      "assets/video-fonts/PlusJakartaSans-Bold.ttf",
      "scripts/media/rewrite-video-source-keys.ts",
      "scripts/media/rewrite-video-source-keys.integration.test.ts",
      "docs/kb/06-studio-video.md",
    ];
    for (const f of leftovers) {
      expect(owned.some((p) => pathMatchesPattern(f, p)), `${f} non couvert`).toBe(true);
    }
    expect(getModuleManifests().length).toBeGreaterThan(0);
  });
});
