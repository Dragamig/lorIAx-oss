import { describe, it, expect, vi } from "vitest";

// La barre d'onglets est un composant client : on neutralise la navigation
// next-intl, qui n'est pas résolvable dans l'environnement Node des tests. Seule
// la fonction pure `resolveActiveTabHref` nous intéresse ici.
vi.mock("@/i18n/routing", () => ({
  usePathname: () => "/admin",
  Link: () => null,
}));

vi.mock("@/lib/modules/hooks.client.generated", () => ({ registerIncludedModuleHooks: () => {} }));

import { resolveActiveTabHref, composeAdminTabs, BASE_ADMIN_TABS } from "./admin-tabs";
import { getModuleManifests } from "@/lib/modules/registry";

/** Onglets de la barre d'administration, dans l'ordre du composant. */
const TAB_HREFS = [
  "/admin/users",
  "/admin/teams",
  "/admin/organizations",
  "/admin/templates",
  "/admin/labels",
  "/admin/editor",
  "/admin/modules",
  "/admin/meeting-rooms",
  "/admin/license",
  "/admin/telemetry",
  "/admin/system",
];

function activeTabs(pathname: string): string[] {
  const active = resolveActiveTabHref(pathname, TAB_HREFS);
  return TAB_HREFS.filter((href) => href === active);
}

describe("resolveActiveTabHref", () => {
  it("marque l'onglet correspondant sur une page qui a le sien", () => {
    expect(resolveActiveTabHref("/admin/users", TAB_HREFS)).toBe("/admin/users");
  });

  it("marque l'onglet sur une sous-route d'un onglet existant", () => {
    expect(resolveActiveTabHref("/admin/users/42", TAB_HREFS)).toBe(
      "/admin/users"
    );
  });

  it("marque « Modules et services » sur une page de configuration de module", () => {
    for (const pathname of [
      "/admin/visio",
      "/admin/transcription",
      "/admin/backups",
      "/admin/images",
      "/admin/automations",
      "/admin/ai",
      "/admin/emails",
    ]) {
      expect(resolveActiveTabHref(pathname, TAB_HREFS)).toBe("/admin/modules");
    }
  });

  it("marque « Modules et services » sur une sous-route de configuration", () => {
    expect(resolveActiveTabHref("/admin/ai/settings", TAB_HREFS)).toBe(
      "/admin/modules"
    );
    expect(resolveActiveTabHref("/admin/emails/templates", TAB_HREFS)).toBe(
      "/admin/modules"
    );
  });

  it("laisse la correspondance directe l'emporter sur le manifeste", () => {
    // /admin/system et /admin/meeting-rooms sont des configHref, mais ont leur
    // propre onglet : celui-ci doit gagner.
    expect(resolveActiveTabHref("/admin/system", TAB_HREFS)).toBe(
      "/admin/system"
    );
    expect(resolveActiveTabHref("/admin/meeting-rooms", TAB_HREFS)).toBe(
      "/admin/meeting-rooms"
    );
  });

  it("ne marque jamais deux onglets à la fois", () => {
    const paths = [
      "/admin",
      "/admin/users",
      "/admin/system",
      "/admin/meeting-rooms",
      "/admin/modules",
      "/admin/ai/settings",
      "/admin/emails/logs",
      "/admin/automations",
      ...getModuleManifests()
        .map((m) => m.configHref)
        .filter((href): href is string => Boolean(href)),
    ];
    for (const pathname of paths) {
      expect(activeTabs(pathname).length).toBeLessThanOrEqual(1);
    }
  });

  it("ne marque rien sur une page d'administration sans onglet ni module", () => {
    expect(resolveActiveTabHref("/admin", TAB_HREFS)).toBeNull();
  });

  it("couvre toutes les routes de configuration du manifeste", () => {
    for (const manifest of getModuleManifests()) {
      if (!manifest.configHref) continue;
      expect(resolveActiveTabHref(manifest.configHref, TAB_HREFS)).not.toBeNull();
    }
  });
});

describe("neutral composition (no commercial module)", () => {
  it("admin_tabs_neutral_has_no_license_organizations_telemetry", () => {
    const hrefs = composeAdminTabs(BASE_ADMIN_TABS, []).map((t) => t.href);
    expect(hrefs).toEqual([
      "/admin/users",
      "/admin/teams",
      "/admin/templates",
      "/admin/labels",
      "/admin/editor",
      "/admin/modules",
      "/admin/meeting-rooms",
      "/admin/system",
    ]);
  });

  it("slot_tabs_are_inserted_after_their_anchor_and_unknown_anchor_goes_before_system", () => {
    const icon = BASE_ADMIN_TABS[0].icon;
    const t = (href: string, after?: string) => ({ href, label: href, icon, access: ["admin" as const], after });
    const hrefs = composeAdminTabs(BASE_ADMIN_TABS, [t("/x", "/admin/teams"), t("/y", "/nope"), t("/z")]).map((e) => e.href);
    expect(hrefs.indexOf("/x")).toBe(hrefs.indexOf("/admin/teams") + 1);
    expect(hrefs.slice(-3)).toEqual(["/y", "/z", "/admin/system"]);
  });

  it("internal_modules_never_produce_a_tab", () => {
    for (const m of getModuleManifests()) {
      if (m.internal) {
        expect(m.nav).toEqual([]);
        expect(m.configHref).toBeUndefined();
      }
    }
  });
});
