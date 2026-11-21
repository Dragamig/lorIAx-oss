import { describe, expect, it } from "vitest";
import { coverUrl, pickCoverColumn } from "./gallery";

describe("pickCoverColumn", () => {
  it("returns the first image column", () => {
    const cols = [{ id: "a", type: "text" }, { id: "b", type: "image" }, { id: "c", type: "image" }];
    expect(pickCoverColumn(cols)?.id).toBe("b");
  });
  it("returns null without image column", () => {
    expect(pickCoverColumn([{ id: "a", type: "text" }, { id: "b", type: "attachment" }])).toBeNull();
  });
});

describe("coverUrl", () => {
  it("accepts http, https and relative urls", () => {
    expect(coverUrl("https://x.fr/a.png")).toBe("https://x.fr/a.png");
    expect(coverUrl("/api/files/a.png")).toBe("/api/files/a.png");
  });
  it("rejects empty, non-string, protocol-relative and other schemes", () => {
    expect(coverUrl("")).toBeNull();
    expect(coverUrl(null)).toBeNull();
    expect(coverUrl(3)).toBeNull();
    expect(coverUrl("//evil.com/a.png")).toBeNull();
    expect(coverUrl("javascript:alert(1)")).toBeNull();
  });
});
