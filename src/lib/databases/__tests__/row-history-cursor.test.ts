import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { encodeHistoryCursor, decodeHistoryCursor, InvalidHistoryCursorError } from "../row-history-read";

describe("decodeHistoryCursor", () => {
  const id = randomUUID();
  it("accepte une date réelle et conserve les microsecondes", () => {
    const t = "2026-02-28T23:59:59.123456Z";
    expect(decodeHistoryCursor(encodeHistoryCursor(t, id))).toEqual({ t, i: id });
  });
  it.each([
    "2026-02-31T00:00:00.000000Z",
    "9999-99-99T99:99:99.000000Z",
    "2026-13-01T00:00:00.000000Z",
    "2026-01-01T24:00:00.000000Z",
  ])("rejette la date impossible %s", (t) => {
    expect(() => decodeHistoryCursor(encodeHistoryCursor(t, id))).toThrow(InvalidHistoryCursorError);
  });
});
