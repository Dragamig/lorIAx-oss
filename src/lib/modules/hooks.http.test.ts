import { describe, it, expect, vi } from "vitest";

vi.mock("./hooks.http.generated", () => ({
  collectIncludedHttpHooks: () => ({ resolveOrgSlug: undefined, publicPaths: undefined, syncOrgCookie: undefined }),
}));

import { getHttpHooks } from "./hooks.http";

describe("fusion des hooks http", () => {
  it("une valeur undefined n'ecrase jamais le neutre", async () => {
    const h = getHttpHooks();
    expect(h.resolveOrgSlug("acme.example.com", "/")).toBeNull();
    expect(h.publicPaths).toEqual([]);
    const res = { marker: 1 } as never;
    expect(await h.syncOrgCookie({} as never, res)).toBe(res);
  });
});
