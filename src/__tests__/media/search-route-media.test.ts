import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  active: true,
  search: vi.fn(),
  content: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: () => Promise.resolve({ id: "u1", globalRole: "member" }) }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve("org1") }));
vi.mock("@/lib/auth/check-access", () => ({
  getAccessibleSpaceIds: () => Promise.resolve([]),
  isGlobalAdmin: () => false,
}));
vi.mock("@/lib/db", () => ({
  db: {
    execute: () => Promise.resolve({ rows: [] }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  },
}));
vi.mock("@/lib/ai/embeddings", () => ({
  searchSemantic: vi.fn(),
  isEmbeddingConfiguredAsync: () => Promise.resolve(false),
}));
vi.mock("@/lib/ai/rerank", () => ({ rerankCandidates: (_q: string, c: unknown[]) => Promise.resolve(c) }));
vi.mock("@/lib/modules/enablement", () => ({ isModuleActive: () => Promise.resolve(h.active) }));
vi.mock("@/lib/media/search", () => ({ searchMedia: h.search }));
vi.mock("@/lib/media/ai/content-search", () => ({ searchMediaContent: h.content }));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/route";

const get = (q: string) => GET(new NextRequest(`http://localhost/api/search?q=${q}&rerank=0`));

beforeEach(() => {
  h.active = true;
  h.search.mockReset();
  h.search.mockResolvedValue([{ id: "m1", filename: "logo.png" }]);
  h.content.mockReset().mockResolvedValue([]);
});

describe("GET /api/search : médias", () => {
  it("ajoute media quand le module library est actif", async () => {
    const body = await (await get("logo")).json();
    expect(body.media).toEqual([{ id: "m1", filename: "logo.png" }]);
    expect(h.search).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "org1", "logo");
  });

  it("omet media quand le module est inactif", async () => {
    h.active = false;
    const body = await (await get("logo")).json();
    expect(body).not.toHaveProperty("media");
    expect(h.search).not.toHaveBeenCalled();
  });

  it("une panne de la recherche de médias ne casse pas la recherche", async () => {
    h.search.mockRejectedValue(new Error("boom"));
    const res = await get("logo");
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("media");
  });
});

describe("GET /api/search : médias par contenu", () => {
  it("ajoute mediaContent sans le texte brut, sur la surface search et sous l'identité de la session", async () => {
    h.content.mockResolvedValue([{ id: "m2", filename: "contrat.pdf", snippet: "préavis", chunkText: "texte brut" }]);
    const body = await (await get("contrat")).json();
    expect(body.mediaContent).toEqual([{ id: "m2", filename: "contrat.pdf", snippet: "préavis" }]);
    expect(h.content).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), "org1", "contrat", { surface: "search" });
  });

  it("omet mediaContent quand rien d'indexé n'est lisible", async () => {
    const body = await (await get("contrat")).json();
    expect(body).not.toHaveProperty("mediaContent");
  });

  it("module inactif : aucune recherche par contenu", async () => {
    h.active = false;
    await get("contrat");
    expect(h.content).not.toHaveBeenCalled();
  });
});
