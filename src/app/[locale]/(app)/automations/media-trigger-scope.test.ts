import { describe, expect, it } from "vitest";
import { mediaTriggerSubtitleKey } from "./media-trigger-scope";

describe("mediaTriggerSubtitleKey", () => {
  it("reflète la portée du déclencheur", () => {
    expect(mediaTriggerSubtitleKey({})).toBe("scopeAny");
    expect(mediaTriggerSubtitleKey({ scope: "orphan" })).toBe("scopeOrphan");
    expect(mediaTriggerSubtitleKey({ scope: "space", spaceId: "x" })).toBe("scopeSpace");
    expect(mediaTriggerSubtitleKey({ scope: "bogus" })).toBe("scopeAny");
  });
});
