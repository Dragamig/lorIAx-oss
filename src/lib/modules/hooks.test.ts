import { Blocks } from "lucide-react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import { reachable, SRC } from "./__fixtures__/import-graph";

const barrelCalls = vi.hoisted(() => ({ server: 0, client: 0, env: 0, http: 0 }));
vi.mock("./hooks.server.generated", () => ({
  registerIncludedModuleHooks: () => { barrelCalls.server++; },
}));
vi.mock("./hooks.client.generated", () => ({
  registerIncludedModuleHooks: () => { barrelCalls.client++; },
}));

import { getHooks, registerHooks, resetHooksForTests, NEUTRAL_HOOKS } from "./hooks";
import { getClientSlots, registerClientSlots, resetClientSlotsForTests } from "./hooks.client";
import { getEnvHooks } from "./hooks.env";
import { getHttpHooks } from "./hooks.http";

describe("hooks serveur neutres", () => {
  beforeEach(() => resetHooksForTests());

  it("neutral_hooks_allow_everything", async () => {
    const h = getHooks();
    expect(await h.usage.checkUsersLimit("o")).toEqual({ current: 0, max: null, exceeded: false, percentage: 0 });
    expect(await h.usage.checkSpacesLimit("o")).toEqual({ current: 0, max: null, exceeded: false, percentage: 0 });
    expect(await h.usage.getOrgStorageLimitBytes("o")).toBeNull();
    expect(await h.entitlements.getEntitledModuleIds("o")).toBeNull();
    expect(await h.entitlements.hasFeature("sso")).toBe(true);
    expect(await h.entitlements.isFreePlan()).toBe(false);
    await expect(h.lifecycle.start()).resolves.toBeUndefined();
    expect(h.help.tools({ id: "u", email: "u@x.test" })).toEqual({});
    expect(h.help.systemPromptAddendum()).toBe("");
    expect(h.help.unansweredHint()).toBe("");
    expect(await h.getLicenseForClient()).toBeNull();
    expect(getHttpHooks().resolveOrgSlug("acme.example.com", "/")).toBeNull();
    expect(getEnvHooks().shape).toEqual({});
  });

  it("require_feature_wrapper_passes_through", async () => {
    const handler = vi.fn(async (..._a: string[]) => "ok");
    const wrapped = getHooks().entitlements.requireFeature("sso")(handler);
    expect(await wrapped("a", "b")).toBe("ok");
    expect(handler).toHaveBeenCalledWith("a", "b");
  });

  it("sync_org_cookie_returns_response_untouched", async () => {
    const res = { marker: 1 } as never;
    expect(await getHttpHooks().syncOrgCookie({} as never, res)).toBe(res);
  });

  it("register_hooks_overrides_only_given_group", async () => {
    registerHooks({
      usage: {
        ...NEUTRAL_HOOKS.usage,
        getOrgStorageLimitBytes: async () => 42,
      },
    });
    const h = getHooks();
    expect(await h.usage.getOrgStorageLimitBytes("o")).toBe(42);
    expect(await h.usage.checkUsersLimit("o")).toMatchObject({ exceeded: false });
    expect(await h.entitlements.hasFeature("x")).toBe(true);
    expect(h.help.tools({ id: "u", email: "u@x.test" })).toEqual({});
  });

  it("register_hooks_merges_inside_a_group", async () => {
    registerHooks({ usage: { getOrgStorageLimitBytes: async () => 7 } });
    const h = getHooks();
    expect(await h.usage.getOrgStorageLimitBytes("o")).toBe(7);
    expect(await h.usage.checkUsersLimit("o")).toMatchObject({ max: null });
  });

  it("get_hooks_loads_generated_barrel_once", async () => {
    // Un vrai premier chargement : on repart d'un module neuf.
    vi.resetModules();
    const before = barrelCalls.server;
    const mod = await import("./hooks");
    mod.getHooks();
    mod.getHooks();
    mod.getHooks();
    expect(barrelCalls.server - before).toBe(1);
  });

  it("reset_hooks_for_tests_does_not_reload_barrel", () => {
    getHooks();
    const before = barrelCalls.server;
    resetHooksForTests();
    getHooks();
    getHooks();
    expect(barrelCalls.server).toBe(before);
  });
});

describe("slots client neutres", () => {
  beforeEach(() => resetClientSlotsForTests());

  it("neutral_client_slots", () => {
    const s = getClientSlots();
    expect(s.SubscriptionTab).toBeNull();
    expect(s.adminTabs).toEqual([]);
    expect(s.helpBugReport).toBe(false);
    expect(typeof s.LicenseProvider).toBe("function");
    const child = "x";
    expect((s.LicenseProvider as unknown as (p: { children: string }) => string)({ children: child })).toBe(child);
  });

  it("register_client_slots_overrides_given_slot_only", () => {
    registerClientSlots({ adminTabs: [{ href: "/a", label: "A", icon: Blocks, access: ["admin"] }] });
    expect(getClientSlots().adminTabs).toHaveLength(1);
    expect(getClientSlots().SubscriptionTab).toBeNull();
  });
});

describe("graphe d'imports", () => {
  const mods = (f: string) => resolve(__dirname, f);
  const forbidden = [mods("hooks.ts"), mods("hooks.server.generated.ts"), mods("hooks.client.generated.ts")];

  it.each([
    ["hooks.env.generated.ts"],
    ["hooks.env.ts"],
    ["hooks.http.generated.ts"],
    ["hooks.http.ts"],
  ])("leaf_%s_does_not_reach_server_barrel", (file) => {
    const r = reachable(mods(file));
    for (const f of forbidden) expect(r.has(f)).toBe(false);
    expect(r.has(resolve(SRC, "lib/env.ts"))).toBe(false);
  });

  it("lib_env_does_not_reach_server_barrel", () => {
    const r = reachable(resolve(SRC, "lib/env.ts"));
    for (const f of forbidden) expect(r.has(f)).toBe(false);
  });
});
