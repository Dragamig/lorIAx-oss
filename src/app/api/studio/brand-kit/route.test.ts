import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  row: vi.fn(),
  access: vi.fn(),
  insert: vi.fn(),
  stored: vi.fn(),
  orgWide: vi.fn(),
}));

vi.mock("@/lib/auth/require-org-scoped", () => ({
  requireOrgScoped: h.ctx,
  OrgScopeError: class extends Error {},
}));
vi.mock("@/lib/auth/check-access", () => ({ isGlobalAdmin: () => true }));
vi.mock("@/lib/media/access", () => ({
  getMediaForAccess: h.row,
  resolveMediaAccess: h.access,
}));
vi.mock("@/lib/media/org-wide", () => ({ isOrgWideSpace: h.orgWide }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => h.stored() }) }) }),
    insert: () => ({ values: (v: unknown) => ({ onConflictDoUpdate: () => h.insert(v) }) }),
  },
}));

import { PUT } from "./route";

const ID = "0b1c2d3e-0000-4000-8000-000000000000";
const put = (logos: { url: string; name: string }[]) =>
  PUT(
    new NextRequest("http://x/api/studio/brand-kit", {
      method: "PUT",
      body: JSON.stringify({ colors: [], logos, fontHeading: null, fontBody: null }),
      headers: { "content-type": "application/json" },
    })
  );
const media = (over: Record<string, unknown> = {}) => ({
  id: ID,
  organizationId: "o1",
  spaceId: "s1",
  uploadedBy: "u1",
  deletedAt: null,
  ...over,
});

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
  h.ctx.mockResolvedValue({ orgId: "o1", user: { id: "u1" } });
  h.row.mockResolvedValue(media());
  h.access.mockResolvedValue({ allowed: true });
  h.insert.mockResolvedValue(undefined);
  h.stored.mockResolvedValue([]);
  h.orgWide.mockResolvedValue(true);
});

describe("PUT /api/studio/brand-kit, logos de la médiathèque", () => {
  it("200 pour un média lisible de l'organisation", async () => {
    const res = await put([{ url: `/api/media/${ID}`, name: "L" }]);
    expect(res.status).toBe(200);
    expect(h.insert).toHaveBeenCalled();
  });

  it("400 identique pour un média inexistant, d'une autre organisation ou en corbeille", async () => {
    const bodies: unknown[] = [];
    for (const row of [null, media({ organizationId: "o2" }), media({ deletedAt: new Date() })]) {
      h.row.mockResolvedValue(row);
      const res = await put([{ url: `/api/media/${ID}`, name: "L" }]);
      expect(res.status).toBe(400);
      bodies.push(await res.json());
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("400 pour un média d'un espace illisible", async () => {
    h.access.mockResolvedValue({ allowed: false, reason: "space" });
    const res = await put([{ url: `/api/media/${ID}`, name: "L" }]);
    expect(res.status).toBe(400);
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("ne consulte pas la médiathèque pour les anciennes URL", async () => {
    const res = await put([{ url: "/api/studio/images/abc", name: "L" }]);
    expect(res.status).toBe(200);
    expect(h.row).not.toHaveBeenCalled();
  });

  it("400 pour un nouveau logo qui n'est pas lisible par toute l'organisation", async () => {
    h.orgWide.mockResolvedValue(false);
    const res = await put([{ url: `/api/media/${ID}`, name: "L" }]);
    expect(res.status).toBe(400);
    expect(h.orgWide).toHaveBeenCalledWith("s1", "o1");
    expect(h.insert).not.toHaveBeenCalled();
  });

  it("400 pour un nouveau logo sans espace", async () => {
    h.row.mockResolvedValue(media({ spaceId: null }));
    h.orgWide.mockResolvedValue(false);
    const res = await put([{ url: `/api/media/${ID}`, name: "L" }]);
    expect(res.status).toBe(400);
  });

  it("un logo déjà enregistré, passé en corbeille, ne bloque pas la sauvegarde", async () => {
    h.stored.mockResolvedValue([{ logos: [{ url: `/api/media/${ID}`, name: "L" }] }]);
    h.row.mockResolvedValue(media({ deletedAt: new Date() }));
    h.access.mockResolvedValue({ allowed: false, reason: "trash" });
    const res = await put([
      { url: `/api/media/${ID}`, name: "Renommé" },
      { url: "/api/studio/images/abc", name: "Autre" },
    ]);
    expect(res.status).toBe(200);
    expect(h.insert).toHaveBeenCalled();
  });

  it("un logo existant reste ignoré, mais un logo nouveau est validé", async () => {
    const NEW = "0b1c2d3e-0000-4000-8000-000000000001";
    h.stored.mockResolvedValue([{ logos: [{ url: `/api/media/${ID}`, name: "L" }] }]);
    h.row.mockImplementation(async (id: string) =>
      id === ID ? media({ deletedAt: new Date() }) : media({ id: NEW, deletedAt: new Date() })
    );
    const res = await put([
      { url: `/api/media/${ID}`, name: "L" },
      { url: `/api/media/${NEW}`, name: "N" },
    ]);
    expect(res.status).toBe(400);
    expect(h.row).toHaveBeenCalledTimes(1);
    expect(h.row).toHaveBeenCalledWith(NEW);
  });
});
