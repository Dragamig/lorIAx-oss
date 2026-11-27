import { beforeEach, describe, expect, it, vi } from "vitest";
import { crmConnections } from "@/lib/db/schema-crm";

const h = vi.hoisted(() => ({
  orgId: "o1" as string | null,
  active: true,
  enabled: false,
  admin: false,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/modules/org-context", () => ({ getModuleScopeOrgId: vi.fn(async () => h.orgId) }));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: vi.fn(async () => h.active) }));
vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn(async () => ({ id: "u1", globalRole: "editor" })) }));
vi.mock("@/lib/crm/access", () => ({ isCrmOrgAdmin: vi.fn(async () => h.admin) }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => (table === crmConnections ? (h.enabled ? [{ enabled: true }] : []) : [{ name: "Acme" }]),
        }),
      }),
    }),
  },
}));
vi.mock("@/components/crm/connection-screen", () => ({ ConnectionScreen: () => null }));
vi.mock("@/components/crm/pipeline/pipeline-screen", () => ({ PipelineScreen: () => null }));
vi.mock("@/components/crm/crm-disabled", () => ({ CrmDisabled: () => null }));

import CrmPage from "@/app/[locale]/(app)/crm/page";
import RaccordementPage from "@/app/[locale]/(app)/crm/raccordement/page";
import { PipelineScreen } from "@/components/crm/pipeline/pipeline-screen";
import { ConnectionScreen } from "@/components/crm/connection-screen";
import { CrmDisabled } from "@/components/crm/crm-disabled";

describe.each([
  ["/crm", CrmPage, PipelineScreen],
  ["/crm/raccordement", RaccordementPage, ConnectionScreen],
])("page %s", (_name, Page, Enabled) => {
  beforeEach(() => {
    h.orgId = "o1";
    h.active = true;
    h.enabled = false;
    h.admin = false;
  });

  it("module indisponible : notFound", async () => {
    h.active = false;
    await expect(Page()).rejects.toThrow("NOT_FOUND");
  });

  it("organisation non activée, membre : désactivé sans bouton", async () => {
    const el = await Page();
    expect(el.type).toBe(CrmDisabled);
    expect(el.props).toEqual({ organisationName: "Acme", isAdmin: false });
  });

  it("non activée, admin : bouton Activer le module", async () => {
    h.admin = true;
    const el = await Page();
    expect(el.type).toBe(CrmDisabled);
    expect(el.props.isAdmin).toBe(true);
  });

  it("activée : écran de la route", async () => {
    h.enabled = true;
    const el = await Page();
    expect(el.type).toBe(Enabled);
    if (Enabled === ConnectionScreen) expect(el.props.organisation).toBe("Acme");
  });
});
