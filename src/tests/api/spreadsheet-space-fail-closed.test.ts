/**
 * Contrôle d'accès — /api/spreadsheet/[sheetId] (GET et PUT)
 *
 * Le contrôle n'était appliqué que si la ligne portait un `spaceId` : les
 * tableurs sans espace (anciens, ou créés par une écriture sans `spaceId`)
 * étaient lisibles et modifiables par tout utilisateur authentifié, toutes
 * organisations confondues. Comportement attendu : fail-closed, et toute
 * écriture renseigne un espace.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let sheetRows: unknown[] = [];
let spaceRows: unknown[] = [];
let selectCall = 0;
const insertValues = vi.fn();

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      selectCall += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(selectCall === 1 ? sheetRows : spaceRows)),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn((v: unknown) => {
      insertValues(v);
      return self;
    }),
    onConflictDoUpdate: vi.fn(() => Promise.resolve(undefined)),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "admin",
  }),
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-a"),
}));

vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: vi.fn().mockResolvedValue(["space-a"]),
}));

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { getAccessibleSpaceIds } from "@/lib/auth/check-access";

const mockAccessible = vi.mocked(getAccessibleSpaceIds);

const ctx = { params: Promise.resolve({ sheetId: "sheet-1" }) };
const newCtx = () => ({ params: Promise.resolve({ sheetId: "sheet-1" }) });

const putReq = (body: unknown) =>
  new NextRequest("http://localhost/api/spreadsheet/sheet-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  selectCall = 0;
  sheetRows = [];
  spaceRows = [{ id: "space-a" }];
  mockAccessible.mockResolvedValue(["space-a"]);
});

describe("GET /api/spreadsheet/[sheetId]", () => {
  it("répond 404 pour un tableur sans espace de rattachement (fail-closed)", async () => {
    sheetRows = [{ data: JSON.stringify({ id: "wb" }), spaceId: null }];
    const { GET } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await GET(new NextRequest("http://localhost/x") as never, ctx);
    expect(res.status).toBe(404);
  });

  it("répond 404 si l'espace du tableur n'est pas accessible", async () => {
    sheetRows = [{ data: JSON.stringify({ id: "wb" }), spaceId: "space-org-b" }];
    const { GET } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await GET(new NextRequest("http://localhost/x") as never, newCtx());
    expect(res.status).toBe(404);
  });

  it("répond 200 si l'espace du tableur est accessible", async () => {
    sheetRows = [{ data: JSON.stringify({ id: "wb" }), spaceId: "space-a" }];
    const { GET } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await GET(new NextRequest("http://localhost/x") as never, newCtx());
    expect(res.status).toBe(200);
  });
});

describe("PUT /api/spreadsheet/[sheetId]", () => {
  it("répond 400 à la création sans spaceId (l'écriture doit toujours rattacher un espace)", async () => {
    sheetRows = [];
    const { PUT } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await PUT(putReq({ data: { id: "wb" } }) as never, newCtx());
    expect(res.status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("répond 403 sur une ligne existante sans espace (fail-closed, pas d'écrasement)", async () => {
    sheetRows = [{ spaceId: null }];
    const { PUT } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await PUT(putReq({ data: { id: "wb" }, spaceId: "space-a" }) as never, newCtx());
    expect(res.status).toBe(403);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("répond 403 si l'espace de la ligne existante n'est pas accessible", async () => {
    sheetRows = [{ spaceId: "space-org-b" }];
    const { PUT } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await PUT(putReq({ data: { id: "wb" } }) as never, newCtx());
    expect(res.status).toBe(403);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("crée le tableur avec son spaceId quand l'espace est accessible", async () => {
    sheetRows = [];
    const { PUT } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await PUT(putReq({ data: { id: "wb" }, spaceId: "space-a" }) as never, newCtx());
    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ sheetId: "sheet-1", spaceId: "space-a" })
    );
  });

  it("ignore un spaceId du corps différent de celui stocké (pas de reparentage)", async () => {
    sheetRows = [{ spaceId: "space-a" }];
    const { PUT } = await import("@/app/api/spreadsheet/[sheetId]/route");
    const res = await PUT(
      putReq({ data: { id: "wb" }, spaceId: "space-org-b" }) as never,
      newCtx()
    );
    expect(res.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-a" })
    );
  });
});
