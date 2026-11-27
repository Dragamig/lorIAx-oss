import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ requireOrgScoped: vi.fn() }));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  }
  return { OrgScopeError, requireOrgScoped: h.requireOrgScoped };
});

import { canEditSpace } from "@/lib/auth/can-edit-space";
import { OrgScopeError } from "@/lib/auth/require-org-scoped";

describe("canEditSpace", () => {
  beforeEach(() => {
    h.requireOrgScoped.mockReset();
  });

  it("interroge le même contrôle que l'API, seuil éditeur", async () => {
    h.requireOrgScoped.mockResolvedValue({});
    await expect(canEditSpace("s1")).resolves.toBe(true);
    expect(h.requireOrgScoped).toHaveBeenCalledWith({
      resource: { type: "space", id: "s1" },
      minPermission: "editor",
    });
  });

  it("rend false sur un refus d'accès", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h.requireOrgScoped.mockRejectedValue(new (OrgScopeError as any)("permission-denied"));
    await expect(canEditSpace("s1")).resolves.toBe(false);
  });

  it("propage les autres erreurs", async () => {
    h.requireOrgScoped.mockRejectedValue(new Error("db down"));
    await expect(canEditSpace("s1")).rejects.toThrow("db down");
  });
});
