import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  session: true,
  orgFound: true,
  moduleOn: true,
  row: undefined as { enabled: boolean } | undefined,
  role: "member",
  membership: true,
  isOrgMember: vi.fn(),
  hasRow: vi.fn(),
}));

vi.mock("@/lib/auth/require-org-scoped", () => {
  class OrgScopeError extends Error {
    constructor(public response: Response) {
      super("scope");
    }
  }
  return {
    OrgScopeError,
    requireOrgScoped: vi.fn(async () => {
      if (!h.session) throw new OrgScopeError(NextResponse.json({ error: "Non authentifié" }, { status: 401 }));
      if (!h.orgFound) throw new OrgScopeError(NextResponse.json({ error: "Introuvable" }, { status: 404 }));
      return { user: { id: "u1", globalRole: h.role }, orgId: "org1", orgSlug: "x" };
    }),
  };
});
vi.mock("@/lib/modules/guard", () => ({
  guardModuleEnabled: vi.fn(async () =>
    h.moduleOn ? null : NextResponse.json({ error: "Module crm désactivé" }, { status: 404 })
  ),
}));
vi.mock("@/lib/org/resolve-request-org", () => ({
  hasOrgMembershipRow: (...a: unknown[]) => {
    h.hasRow(...a);
    return Promise.resolve(h.membership);
  },
  isOrgMember: (...a: unknown[]) => h.isOrgMember(...a),
}));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (h.row ? [h.row] : []) }) }),
    }),
  },
}));

import { requireCrm } from "../access";

const body = async (r: Response) => ({ status: r.status, json: await r.json() });
const MEMBER = { level: "member", requireEnabled: false } as const;

beforeEach(() => {
  h.session = true;
  h.orgFound = true;
  h.moduleOn = true;
  h.row = { enabled: true };
  h.role = "member";
  h.membership = true;
  h.isOrgMember.mockClear();
  h.hasRow.mockClear();
});

describe("requireCrm", () => {
  it("sans session : 401", async () => {
    h.session = false;
    const r = await requireCrm(MEMBER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((await body(r.response)).status).toBe(401);
  });

  it("organisation introuvable : 404", async () => {
    h.orgFound = false;
    const r = await requireCrm(MEMBER);
    if (r.ok) throw new Error("attendu refus");
    expect(await body(r.response)).toEqual({ status: 404, json: { error: "Introuvable" } });
  });

  it("module indisponible sur l'instance : 404 avant tout contrôle de rôle", async () => {
    h.moduleOn = false;
    const r = await requireCrm({ level: "admin", requireEnabled: false });
    if (r.ok) throw new Error("attendu refus");
    expect((await body(r.response)).status).toBe(404);
    expect(h.hasRow).not.toHaveBeenCalled();
  });

  it("requireEnabled et ligne absente : 404, même corps que module indisponible", async () => {
    h.moduleOn = false;
    const a = await requireCrm({ level: "member", requireEnabled: true });
    h.moduleOn = true;
    h.row = undefined;
    const b = await requireCrm({ level: "member", requireEnabled: true });
    if (a.ok || b.ok) throw new Error("attendu refus");
    expect(await body(b.response)).toEqual({ status: 404, json: { error: "Introuvable" } });
    expect((await body(a.response)).status).toBe(404);
  });

  it("requireEnabled et enabled faux : 404", async () => {
    h.row = { enabled: false };
    const r = await requireCrm({ level: "member", requireEnabled: true });
    if (r.ok) throw new Error("attendu refus");
    expect(await body(r.response)).toEqual({ status: 404, json: { error: "Introuvable" } });
  });

  it("membre simple sur route admin : 403", async () => {
    const r = await requireCrm({ level: "admin", requireEnabled: true });
    if (r.ok) throw new Error("attendu refus");
    expect(await body(r.response)).toEqual({ status: 403, json: { error: "Accès refusé" } });
  });

  it("module absent et non admin : 404, jamais 403", async () => {
    h.row = undefined;
    const r = await requireCrm({ level: "admin", requireEnabled: true });
    if (r.ok) throw new Error("attendu refus");
    expect((await body(r.response)).status).toBe(404);
  });

  it("admin global sans ligne d'appartenance à l'organisation visée : 403", async () => {
    h.role = "admin";
    h.membership = false;
    const r = await requireCrm({ level: "admin", requireEnabled: true });
    if (r.ok) throw new Error("attendu refus");
    expect((await body(r.response)).status).toBe(403);
    expect(h.hasRow).toHaveBeenCalledWith("u1", "org1");
  });

  it("admin membre : ok", async () => {
    h.role = "admin";
    const r = await requireCrm({ level: "admin", requireEnabled: true });
    expect(r).toMatchObject({ ok: true, orgId: "org1", isAdmin: true, enabled: true });
  });

  it("super_admin : ok sans appartenance", async () => {
    h.role = "super_admin";
    h.membership = false;
    const r = await requireCrm({ level: "admin", requireEnabled: true });
    expect(r).toMatchObject({ ok: true, isAdmin: true });
    expect(h.hasRow).not.toHaveBeenCalled();
  });

  it("membre simple sur route member : ok, isAdmin faux, enabled lu", async () => {
    h.row = { enabled: false };
    const r = await requireCrm(MEMBER);
    expect(r).toMatchObject({ ok: true, isAdmin: false, enabled: false });
  });

  it("isOrgMember n'est jamais appelée", async () => {
    h.role = "admin";
    await requireCrm({ level: "admin", requireEnabled: true });
    h.role = "member";
    await requireCrm({ level: "admin", requireEnabled: true });
    expect(h.isOrgMember).not.toHaveBeenCalled();
  });
});
