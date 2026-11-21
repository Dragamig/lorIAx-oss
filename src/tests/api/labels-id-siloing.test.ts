/**
 * Cloisonnement multi-tenant — /api/labels/[id] (PATCH/DELETE)
 *
 * La route ne gère que les labels globaux (isGlobal, sans org, partagés par
 * toute l'instance). L'écriture est réservée au super_admin (propriétaire
 * d'instance) : un admin d'org ne doit pas pouvoir renommer/supprimer une
 * taxonomie vue par les autres organisations.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let returningRows: unknown[] = [];

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    returning: vi.fn(() => Promise.resolve(returningRows)),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getSessionUser } from "@/lib/auth/get-user";
const mockUser = vi.mocked(getSessionUser);

const asUser = (globalRole: string) =>
  ({ id: "u", name: "U", email: "u@x.com", globalRole }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  returningRows = [{ id: "lab-1", name: "ok", color: "#111111", isGlobal: true }];
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = () =>
  new NextRequest("http://localhost/api/labels/lab-1", {
    method: "PATCH",
    body: JSON.stringify({ name: "renamed" }),
  });

describe("/api/labels/[id] — réservé au super_admin", () => {
  it("PATCH 403 pour un admin d'org (non super_admin)", async () => {
    mockUser.mockResolvedValue(asUser("admin"));
    const { PATCH } = await import("@/app/api/labels/[id]/route");
    const res = await PATCH(patchReq() as never, ctx("lab-1"));
    expect(res.status).toBe(403);
  });

  it("DELETE 403 pour un admin d'org (non super_admin)", async () => {
    mockUser.mockResolvedValue(asUser("admin"));
    const { DELETE } = await import("@/app/api/labels/[id]/route");
    const res = await DELETE(
      new NextRequest("http://localhost/api/labels/lab-1", { method: "DELETE" }) as never,
      ctx("lab-1")
    );
    expect(res.status).toBe(403);
  });

  it("PATCH 200 pour un super_admin", async () => {
    mockUser.mockResolvedValue(asUser("super_admin"));
    const { PATCH } = await import("@/app/api/labels/[id]/route");
    const res = await PATCH(patchReq() as never, ctx("lab-1"));
    expect(res.status).toBe(200);
  });
});
