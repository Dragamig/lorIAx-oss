/**
 * Comportement de l'edition sans module commercial (profil oss), sur les barils generes
 * reels : aucun enregistrement, donc valeurs neutres. Dans l'arbre commercial par defaut,
 * le module est inclus et ces cas ne s'appliquent pas (voir commercial-composition.integration.test.ts).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./toggle", () => ({ getModuleToggles: vi.fn() }));

import { getModuleManifest, getModuleManifests } from "./registry";
import { getHooks } from "./hooks";
import { getClientSlots } from "./hooks.client";
import { getEnvHooks } from "./hooks.env";
import { getHttpHooks } from "./hooks.http";
import { isModuleActive } from "./enablement";
import { getModuleToggles } from "./toggle";

const withoutCommercial = getModuleManifest("commercial") === undefined;

describe.skipIf(!withoutCommercial)("edition sans module commercial", () => {
  it("neutral_edition_behaves_unlimited", async () => {
    const h = getHooks();
    for (const org of ["org-1", "org-2"]) {
      expect(await h.usage.checkUsersLimit(org)).toEqual({ current: 0, max: null, exceeded: false, percentage: 0 });
      expect(await h.usage.checkSpacesLimit(org)).toEqual({ current: 0, max: null, exceeded: false, percentage: 0 });
      expect(await h.usage.getOrgStorageLimitBytes(org)).toBeNull();
    }
    expect(await h.entitlements.getEntitledModuleIds("org-1")).toBeNull();
    expect(await h.entitlements.getEntitledModuleIds()).toBeNull();
    for (const f of ["sso", "audit_log", "custom_branding", "ai_advanced", "api_access", "scim", "ha_cluster", "white_label"]) {
      expect(await h.entitlements.hasFeature(f), f).toBe(true);
    }
    expect(await h.entitlements.isFreePlan()).toBe(false);
    const handler = vi.fn(async (x: string) => `ok:${x}`);
    expect(await h.entitlements.requireFeature("sso")(handler)("a")).toBe("ok:a");
    expect(h.help.tools({ id: "u", email: "u@example.test" })).toEqual({});
    expect(h.help.systemPromptAddendum()).toBe("");
    expect(h.help.unansweredHint()).toBe("");
    expect(await h.getLicenseForClient()).toBeNull();
    await expect(h.lifecycle.start()).resolves.toBeUndefined();
  });

  it("neutral_edition_has_no_subdomain_org_routing_and_no_extra_env", async () => {
    expect(getHttpHooks().resolveOrgSlug("acme.example.com", "/")).toBeNull();
    expect(getHttpHooks().resolveOrgSlug("localhost:3000", "/org/acme/documents")).toBeNull();
    expect(getHttpHooks().publicPaths).toEqual([]);
    const res = { marker: 1 } as never;
    expect(await getHttpHooks().syncOrgCookie({} as never, res)).toBe(res);
    expect(getEnvHooks().shape).toEqual({});
  });

  it("neutral_edition_client_slots_show_no_license_billing_org_or_cloud_ui", () => {
    const s = getClientSlots();
    expect(s.SubscriptionTab).toBeNull();
    expect(s.OrgSwitcher).toBeNull();
    expect(s.adminTabs).toEqual([]);
    expect(s.cloudSignup).toBe(false);
    expect(s.helpBugReport).toBe(false);
    const child = "x";
    expect((s.LicenseProvider as unknown as (p: { children: string }) => string)({ children: child })).toBe(child);
  });

  it("neutral_edition_activates_every_compiled_module_and_drops_studiovideo", async () => {
    const manifests = getModuleManifests();
    vi.mocked(getModuleToggles).mockResolvedValue(Object.fromEntries(manifests.map((m) => [m.id, true])));
    for (const m of manifests) {
      expect(await isModuleActive(m.id, "org-1"), m.id).toBe(true);
    }
    expect(manifests.map((m) => m.id)).not.toContain("studiovideo");
    expect(await isModuleActive("studiovideo")).toBe(false);
  });
});
