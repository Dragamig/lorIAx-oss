import { describe, it, expect } from "vitest";
import {
  readRowParam,
  withRowParam,
  viewRedirectUrl,
} from "@/lib/bases/row-deep-link";

const U = "3f2b8c1e-5d4a-4b6f-9a1c-0e7d2b3c4f5a";

describe("readRowParam", () => {
  it("reads a valid uuid row param", () => {
    expect(readRowParam(new URLSearchParams({ row: U }))).toBe(U);
  });

  it("rejects a non-uuid row param", () => {
    for (const value of ["abc", "", "../etc", U + "x"]) {
      expect(readRowParam(new URLSearchParams({ row: value }))).toBeNull();
    }
  });

  it("returns null when the row param is absent", () => {
    expect(readRowParam(new URLSearchParams({ spaceId: "s" }))).toBeNull();
  });
});

describe("withRowParam", () => {
  it("sets the row param and keeps the others", () => {
    expect(withRowParam("/bases/d/views/v?spaceId=s", U)).toBe(
      "/bases/d/views/v?spaceId=s&row=" + U,
    );
  });

  it("removes the row param", () => {
    expect(withRowParam("/bases/d/views/v?spaceId=s&row=" + U, null)).toBe(
      "/bases/d/views/v?spaceId=s",
    );
  });

  it("drops the question mark when no param is left", () => {
    expect(withRowParam("/x?row=" + U, null)).toBe("/x");
  });

  it("keeps the hash", () => {
    expect(withRowParam("/x?a=1#top", U).endsWith("#top")).toBe(true);
  });
});

describe("viewRedirectUrl", () => {
  it("builds the view redirect url without a row", () => {
    expect(
      viewRedirectUrl({ databaseId: "d", viewId: "v", spaceId: "s", rowId: null }),
    ).toBe("/bases/d/views/v?spaceId=s");
  });

  it("appends the row param when a row is given", () => {
    expect(
      viewRedirectUrl({ databaseId: "d", viewId: "v", spaceId: "s", rowId: U }),
    ).toBe("/bases/d/views/v?spaceId=s&row=" + U);
  });
});
