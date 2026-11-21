/**
 * Unit test for the entitlement-check logic in the PATCH /api/admin/modules/[id] route.
 *
 * Approach: focused unit test (not a route-handler integration test).
 * Rationale: no route-handler test pattern exists in this repo (only lib-level unit tests
 * under src/lib/modules/). Mocking Next.js server internals (NextResponse, async params,
 * session cookies, DB) would be brittle and not established here. Instead we test the
 * exact entitled-set construction + isEntitled decision the route makes, using the same
 * helpers the route imports. This encodes the regression precisely: the old code built
 * Set<Feature> from license.payload.features; the new code must use getEntitledModuleIds.
 */
import { describe, it, expect } from "vitest";
import { getEntitledModuleIds } from "@/lib/modules/catalog";
import { isEntitled } from "@/lib/modules/resolve";
import { getModuleManifest } from "@/lib/modules/registry";

// ── helpers mirroring the fixed route logic ──────────────────────────────────

function buildEntitledSet(
  license: { valid: boolean; payload: { plan: string; modules?: string[] } } | null
): Set<string> {
  return license?.valid
    ? getEntitledModuleIds(
        license.payload.plan as Parameters<typeof getEntitledModuleIds>[0],
        license.payload.modules ?? []
      )
    : new Set<string>();
}

// ── fixtures ──────────────────────────────────────────────────────────────────

const growthLicense = {
  valid: true as const,
  payload: { plan: "growth" as const, modules: [] },
};

const freeLicense = {
  valid: true as const,
  payload: { plan: "free" as const, modules: [] },
};

const noLicense = null;

// ── tests ─────────────────────────────────────────────────────────────────────

describe("route toggle entitlement — entitled-set construction", () => {
  it("growth license → 'ai' is entitled (in growth socle)", () => {
    const manifest = getModuleManifest("ai")!;
    const entitled = buildEntitledSet(growthLicense);
    expect(isEntitled(manifest, entitled)).toBe(true);
  });

  it("growth license → 'ldap' is NOT entitled (licensed, socle enterprise uniquement)", () => {
    const manifest = getModuleManifest("ldap")!;
    const entitled = buildEntitledSet(growthLicense);
    expect(isEntitled(manifest, entitled)).toBe(false);
  });

  it("growth license + module add-on 'ldap' → 'ldap' IS entitled", () => {
    const licenseWithAddon = {
      valid: true as const,
      payload: { plan: "growth" as const, modules: ["ldap"] },
    };
    const manifest = getModuleManifest("ldap")!;
    const entitled = buildEntitledSet(licenseWithAddon);
    expect(isEntitled(manifest, entitled)).toBe(true);
  });

  it("module core 'studio' (canvas design) est toujours entitled, sans licence", () => {
    const manifest = getModuleManifest("studio")!;
    expect(isEntitled(manifest, buildEntitledSet(noLicense))).toBe(true);
    expect(isEntitled(manifest, buildEntitledSet(growthLicense))).toBe(true);
  });

  it("null license → 'ai' is NOT entitled", () => {
    const manifest = getModuleManifest("ai")!;
    const entitled = buildEntitledSet(noLicense);
    expect(isEntitled(manifest, entitled)).toBe(false);
  });

  it("free license → 'ai' is NOT entitled (not in free socle)", () => {
    const manifest = getModuleManifest("ai")!;
    const entitled = buildEntitledSet(freeLicense);
    expect(isEntitled(manifest, entitled)).toBe(false);
  });

  it("core module 'collab' is always entitled regardless of license", () => {
    const manifest = getModuleManifest("collab")!;
    expect(isEntitled(manifest, buildEntitledSet(noLicense))).toBe(true);
    expect(isEntitled(manifest, buildEntitledSet(freeLicense))).toBe(true);
    expect(isEntitled(manifest, buildEntitledSet(growthLicense))).toBe(true);
  });

  /**
   * Regression guard: the old (buggy) code built Set<Feature> from
   * license.payload.features (e.g. ["sso", "audit_log"]).
   * For a growth license with features=[], that set is empty → isEntitled("ai") = false → 403.
   * The helper below simulates the OLD logic to show it would have failed.
   */
  it("REGRESSION: old features-based set does NOT entitle 'ai' on growth license", () => {
    // Simulate old buggy construction
    const oldFeatures: string[] = []; // a typical growth license has no Feature enum values for module ids
    const oldEntitled = new Set<string>(oldFeatures);
    const manifest = getModuleManifest("ai")!;
    // Old logic would return false → 403 (the bug)
    expect(isEntitled(manifest, oldEntitled)).toBe(false);
    // New logic returns true (the fix)
    const newEntitled = buildEntitledSet(growthLicense);
    expect(isEntitled(manifest, newEntitled)).toBe(true);
  });
});
