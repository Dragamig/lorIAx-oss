import { describe, it, expect, vi, afterEach } from "vitest";
import { apiPost } from "@/components/editor/extensions/database-block/api";

afterEach(() => vi.unstubAllGlobals());

describe("apiPost", () => {
  it("apiPost transmet les en-têtes en plus de Content-Type", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiPost("/x", { a: 1 }, { headers: { "X-Row-Source": "import" } });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({ "Content-Type": "application/json", "X-Row-Source": "import" });
  });
});
