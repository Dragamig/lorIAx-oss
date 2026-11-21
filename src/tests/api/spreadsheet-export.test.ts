/**
 * Export .xlsx — GET /api/spreadsheet/[sheetId]/export
 * Mêmes contrôles d'accès que GET /api/spreadsheet/[sheetId] : session, espace
 * obligatoire, espace accessible dans l'org courante, 404 muet (jamais 403).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let sheetRows: unknown[] = [];

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/auth/check-access", () => ({ getAccessibleSpaceIds: vi.fn() }));
vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() => Promise.resolve(sheetRows)),
  };
  return { db: self };
});
vi.mock("@/lib/spreadsheet/workbook-to-xlsx", () => ({
  workbookToXlsx: vi.fn().mockResolvedValue(Buffer.from("xlsx-bytes")),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { workbookToXlsx } from "@/lib/spreadsheet/workbook-to-xlsx";
import { GET } from "@/app/api/spreadsheet/[sheetId]/export/route";

const mockUser = vi.mocked(getSessionUser);
const mockAccessible = vi.mocked(getAccessibleSpaceIds);

const call = (qs = "") =>
  GET(new NextRequest(`http://localhost/api/spreadsheet/sheet-1/export${qs}`), {
    params: Promise.resolve({ sheetId: "sheet-1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockUser.mockResolvedValue({ id: "user-a", globalRole: "member" } as any);
  mockAccessible.mockResolvedValue(["space-a"]);
  sheetRows = [{ data: JSON.stringify({ id: "wb", sheets: {} }), spaceId: "space-a" }];
});

describe("GET /api/spreadsheet/[sheetId]/export", () => {
  it("401 sans session", async () => {
    mockUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(workbookToXlsx).not.toHaveBeenCalled();
  });

  it("404 si le tableur n'existe pas", async () => {
    sheetRows = [];
    expect((await call()).status).toBe(404);
  });

  it("404 si le tableur n'a pas d'espace (fail-closed)", async () => {
    sheetRows = [{ data: "{}", spaceId: null }];
    expect((await call()).status).toBe(404);
  });

  it("404 muet (jamais 403) pour un tableur d'une autre organisation", async () => {
    sheetRows = [{ data: "{}", spaceId: "space-autre-org" }];
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Tableur introuvable" });
    expect(workbookToXlsx).not.toHaveBeenCalled();
  });

  it("refuse un lecteur sans droit sur l'espace, comme le GET existant", async () => {
    mockAccessible.mockResolvedValue([]);
    const res = await call();
    expect(res.status).toBe(404);
    expect(workbookToXlsx).not.toHaveBeenCalled();
  });

  it("200 avec Content-Type xlsx et Content-Disposition", async () => {
    const res = await call("?name=Demande%20%C3%A9t%C3%A9");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd).toContain("attachment");
    expect(cd).toContain(".xlsx");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("xlsx-bytes");
  });

  it("nom par défaut tableur.xlsx", async () => {
    const res = await call();
    expect(res.headers.get("Content-Disposition")).toContain("tableur.xlsx");
  });
});
