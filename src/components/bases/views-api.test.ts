import { describe, it, expect, vi, afterEach } from "vitest";
import { viewsApi } from "./views-api";
import type { ViewDef } from "./view-scope";

const view: ViewDef = {
  id: "v1",
  name: "Pipeline",
  type: "table",
  isDefault: true,
  position: 0,
  config: { sort: "titre" },
  scope: "shared",
  createdBy: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("viewsApi.restore", () => {
  it("envoie isDefault quand la vue l'avait", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "v2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await viewsApi.restore("db1", view);

    expect(res).toEqual({ ok: true, data: { id: "v2" } });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ name: "Pipeline", type: "table", scope: "shared", config: { sort: "titre" }, isDefault: true });
  });

  it("n'envoie pas isDefault quand la vue ne le porte pas", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "v2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { isDefault: _omit, ...without } = view;

    await viewsApi.restore("db1", without as ViewDef);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect("isDefault" in body).toBe(false);
  });
});
