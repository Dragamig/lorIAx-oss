import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHookBarrels, HOOK_BARREL_FILES } from "./generate-module-composition";
import type { ModuleId, ModuleManifest } from "../src/lib/modules/types";

const ROOT = resolve(__dirname, "..");
type M = Pick<ModuleManifest, "id" | "hooks">;
const fake = (id: string, hooks?: M["hooks"]): M => ({ id: id as ModuleId, hooks });

describe("barils de hooks generes", () => {
  it("barrel_imports_only_included_modules_with_hooks", () => {
    const manifests = [
      fake("crm"),
      fake("commercial", {
        server: "@/modules/commercial/hooks.server",
        client: "@/modules/commercial/hooks.client",
        env: "@/modules/commercial/hooks.env",
        http: "@/modules/commercial/hooks.http",
      }),
      fake("ldap", { server: "@/modules/ldap/hooks.server" }),
    ];

    const none = renderHookBarrels(manifests, new Set(["crm"] as ModuleId[]));
    for (const file of Object.values(HOOK_BARREL_FILES)) {
      expect(none[file]).not.toMatch(/^import .*modules\//m);
    }

    const all = renderHookBarrels(manifests, new Set(["crm", "commercial", "ldap"] as ModuleId[]));
    expect(all[HOOK_BARREL_FILES.server]).toContain('"@/modules/commercial/hooks.server"');
    expect(all[HOOK_BARREL_FILES.server]).toContain('"@/modules/ldap/hooks.server"');
    expect(all[HOOK_BARREL_FILES.client]).toContain('"@/modules/commercial/hooks.client"');
    expect(all[HOOK_BARREL_FILES.client]).not.toContain("ldap");
    expect(all[HOOK_BARREL_FILES.env]).toContain('"@/modules/commercial/hooks.env"');
    expect(all[HOOK_BARREL_FILES.http]).toContain('"@/modules/commercial/hooks.http"');

    const onlyLdap = renderHookBarrels(manifests, new Set(["ldap"] as ModuleId[]));
    expect(onlyLdap[HOOK_BARREL_FILES.server]).not.toContain("commercial");
  });

  it("barrels_keep_canonical_registry_order", () => {
    const manifests = [
      fake("a", { server: "@/m/a" }),
      fake("b", { server: "@/m/b" }),
    ];
    const out = renderHookBarrels(manifests, new Set(["b", "a"] as unknown as ModuleId[]))[HOOK_BARREL_FILES.server];
    expect(out.indexOf("@/m/a")).toBeLessThan(out.indexOf("@/m/b"));
  });

  it("barrels_are_written_on_every_run", () => {
    for (const file of Object.values(HOOK_BARREL_FILES)) {
      const p = resolve(ROOT, "src/lib/modules", file);
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, "utf8")).toContain("AUTO-GÉNÉRÉ");
    }
  });

  it("client_and_leaf_barrels_do_not_import_server_code", () => {
    const manifests = [fake("x", { server: "@/s", client: "@/c", env: "@/e", http: "@/h" })];
    const out = renderHookBarrels(manifests, new Set(["x"] as unknown as ModuleId[]));
    expect(out[HOOK_BARREL_FILES.client]).not.toContain('"@/s"');
    expect(out[HOOK_BARREL_FILES.env]).not.toContain('"@/s"');
    expect(out[HOOK_BARREL_FILES.http]).not.toContain('"@/s"');
    // À compléter en tâche 12 : lecture du baril client généré avec --all.
  });
});
