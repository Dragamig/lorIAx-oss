import { describe, it, expect, vi, beforeEach } from "vitest";

const checkFeature = vi.fn();
const insert = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "u1" }),
}));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({ entitlements: { hasFeature: (f: string) => checkFeature(f) } }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: () => ({
        returning: () => {
          insert();
          return Promise.resolve([{ id: "k1" }]);
        },
      }),
    }),
  },
}));

import { POST } from "./route";

const body = JSON.stringify({ name: "n", scopes: ["search"] });
const mk = (b: string = body) => new Request("http://x/api/user/api-keys", { method: "POST", body: b });

describe("POST /api/user/api-keys", () => {
  beforeEach(() => vi.clearAllMocks());

  it("crée la clé même sans la fonctionnalité api_access (clés aussi utilisées par CalDAV)", async () => {
    checkFeature.mockResolvedValue(false);
    const res = await POST(mk());
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalled();
    expect(checkFeature).not.toHaveBeenCalled();
  });

  it("accepte les portées calendrier exigées par CalDAV", async () => {
    const res = await POST(mk(JSON.stringify({ name: "n", scopes: ["calendars:read", "calendars:write"] })));
    expect(res.status).toBe(200);
    expect(insert).toHaveBeenCalled();
  });

  it("refuse une portée inconnue", async () => {
    const res = await POST(mk(JSON.stringify({ name: "n", scopes: ["calendars:admin"] })));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });
});
