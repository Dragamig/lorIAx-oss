import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getOwn = vi.fn();
const buildViews = vi.fn();
const sessionScope = vi.fn();

vi.mock("@/lib/ai/creation/store", () => ({
  getOwnCreationProposal: (...a: unknown[]) => getOwn(...a),
}));
vi.mock("@/lib/ai/creation-view", () => ({
  buildCreationViews: (...a: unknown[]) => buildViews(...a),
}));
vi.mock("@/lib/ai/proposals/route-utils", () => ({
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  sessionScope: (...a: unknown[]) => sessionScope(...a),
  accessErrorResponse: (e: unknown) => {
    throw e;
  },
}));

import { GET } from "../route";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const get = (qs: string) => GET(new NextRequest(`http://x/api/ai/creations${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  sessionScope.mockResolvedValue({ user: { id: "u1" }, orgId: "org1" });
  buildViews.mockImplementation(async (rows: unknown[]) => rows.map((r) => ({ id: (r as { id: string }).id })));
});

describe("GET /api/ai/creations", () => {
  it("400 sans paramètre ids", async () => {
    expect((await get("")).status).toBe(400);
    expect(getOwn).not.toHaveBeenCalled();
  });

  it("ne renvoie que les propositions de l'utilisateur et de l'org courants, ids d'autrui ignorés", async () => {
    getOwn.mockImplementation(async (_o: string, _u: string, id: string) => (id === uuid(1) ? { id } : null));
    const res = await get(`?ids=${uuid(1)},${uuid(2)}`);
    expect(await res.json()).toEqual({ creations: [{ id: uuid(1) }] });
    expect(getOwn).toHaveBeenCalledWith("org1", "u1", uuid(1));
    expect(getOwn).toHaveBeenCalledWith("org1", "u1", uuid(2));
  });

  it("ignore les ids non UUID et les doublons", async () => {
    getOwn.mockImplementation(async (_o: string, _u: string, id: string) => ({ id }));
    await get(`?ids=nope,${uuid(1)},${uuid(1)}`);
    expect(getOwn).toHaveBeenCalledTimes(1);
  });

  it("plafonne à 50 ids", async () => {
    getOwn.mockImplementation(async (_o: string, _u: string, id: string) => ({ id }));
    const ids = Array.from({ length: 80 }, (_, i) => uuid(i + 1)).join(",");
    const res = await get(`?ids=${ids}`);
    expect(getOwn).toHaveBeenCalledTimes(50);
    expect((await res.json()).creations).toHaveLength(50);
  });
});
