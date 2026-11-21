// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModulesList, type ModuleRow } from "@/app/[locale]/(app)/admin/modules/modules-list";

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock());
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const refresh = vi.fn();
vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const row = (over: Partial<ModuleRow> = {}): ModuleRow => ({
  id: "crm",
  name: "CRM",
  description: "Pipeline",
  category: "contenu",
  icon: "briefcase",
  entitlement: "core",
  manageRole: "super_admin",
  status: "active",
  toggledOn: true,
  missingDeps: [],
  ...over,
});

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
);
afterEach(cleanup);

describe("carte du module CRM", () => {
  it("l'admin d'organisation voit le bouton, le membre non", () => {
    render(<ModulesList modules={[row()]} canManageLicensed={false} crm={{ available: true, enabled: false, canAdminOrg: true }} />);
    expect(screen.getByRole("button", { name: "Activer pour mon organisation" })).toBeTruthy();
    cleanup();
    render(<ModulesList modules={[row()]} canManageLicensed={false} crm={{ available: true, enabled: false, canAdminOrg: false }} />);
    expect(screen.queryByRole("button", { name: "Activer pour mon organisation" })).toBeNull();
  });

  it("module activé : bouton Désactiver pour mon organisation", () => {
    render(<ModulesList modules={[row()]} canManageLicensed={false} crm={{ available: true, enabled: true, canAdminOrg: true }} />);
    expect(screen.getByRole("button", { name: "Désactiver pour mon organisation" })).toBeTruthy();
  });

  it("instance indisponible : bouton désactivé avec raison", () => {
    render(
      <ModulesList
        modules={[row({ status: "disabled", toggledOn: false })]}
        canManageLicensed={false}
        crm={{ available: false, enabled: false, canAdminOrg: true }}
      />,
    );
    const btn = screen.getByRole("button", { name: "Module indisponible sur l'instance" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("carte désactivée visible en thème sombre (classes tokens)", () => {
    render(
      <ModulesList
        modules={[row({ status: "disabled", toggledOn: false })]}
        canManageLicensed={false}
        crm={{ available: true, enabled: false, canAdminOrg: true }}
      />,
    );
    const card = screen.getByTestId("module-card-crm");
    expect(card.className).toContain("bg-muted/30");
    expect(card.className).not.toMatch(/bg-(white|gray-\d+)\b/);
    expect(screen.getByText("CRM").className).not.toMatch(/text-(black|gray)/);
  });

  it("bascule ON : le bouton devient utilisable sans recharger, et la page est rafraîchie", async () => {
    vi.mocked(fetch).mockImplementation((async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes("/api/admin/modules/") ? { states: [{ id: "crm", status: "active", toggledOn: true }] } : {}),
    })) as unknown as typeof fetch);
    refresh.mockClear();
    render(
      <ModulesList
        modules={[row({ status: "disabled", toggledOn: false })]}
        canManageLicensed
        crm={{ available: false, enabled: false, canAdminOrg: true }}
      />,
    );
    expect(screen.getByRole("button", { name: "Module indisponible sur l'instance" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Activer CRM" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Activer pour mon organisation" })).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
  });

  it("bascule OFF : le bouton redevient indisponible", async () => {
    vi.mocked(fetch).mockImplementation((async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes("/api/admin/modules/") ? { states: [{ id: "crm", status: "disabled", toggledOn: false }] } : {}),
    })) as unknown as typeof fetch);
    render(
      <ModulesList
        modules={[row()]}
        canManageLicensed
        crm={{ available: true, enabled: false, canAdminOrg: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Désactiver CRM" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Module indisponible sur l'instance" })).toBeTruthy());
  });
});
