import { describe, it, expect } from "vitest";
import { kindFromMime, isInlineSafe } from "./kind";

describe("kindFromMime", () => {
  it.each([
    ["image/png", "image"],
    ["image/svg+xml", "image"],
    ["application/pdf", "pdf"],
    ["video/mp4", "video"],
    ["audio/mpeg", "audio"],
    ["application/zip", "archive"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "document"],
    ["text/csv", "document"],
    ["application/octet-stream", "other"],
  ])("%s -> %s", (mime, kind) => {
    expect(kindFromMime(mime)).toBe(kind);
  });
});

describe("isInlineSafe", () => {
  it("refuse svg et html", () => {
    expect(isInlineSafe("image/svg+xml")).toBe(false);
    expect(isInlineSafe("text/html")).toBe(false);
  });
  it("accepte la liste blanche", () => {
    for (const m of ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "application/pdf", "audio/mpeg", "video/mp4"]) {
      expect(isInlineSafe(m)).toBe(true);
    }
    expect(isInlineSafe("application/zip")).toBe(false);
  });
});
