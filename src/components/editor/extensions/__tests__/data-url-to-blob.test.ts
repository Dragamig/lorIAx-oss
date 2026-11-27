import { describe, it, expect, vi } from "vitest";
import { dataUrlToBlob } from "../design-export";

describe("dataUrlToBlob", () => {
  it("décode une data URL base64 sans appeler fetch (CSP connect-src 'self')", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const blob = dataUrlToBlob("data:image/png;base64,AQID");
    expect(blob.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("rejette une valeur qui n'est pas une data URL base64", () => {
    expect(() => dataUrlToBlob("https://x/y.png")).toThrow();
  });
});
