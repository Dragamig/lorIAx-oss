import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadDesignThumbnail } from "../design-thumbnail";

afterEach(() => vi.unstubAllGlobals());

describe("uploadDesignThumbnail", () => {
  it("n'appelle pas fetch sur la data URL (CSP connect-src 'self')", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const url = await uploadDesignThumbnail("data:image/png;base64,AQID", "s1");
    expect(url).toBe("/api/media/abc");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as unknown[][];
    expect(calls[0][0]).toBe("/api/studio/images");
  });
});
