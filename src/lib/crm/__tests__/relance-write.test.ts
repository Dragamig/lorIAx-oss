import { describe, it, expect } from "vitest";
import { relanceBody, computeRelanceCell } from "../relance-write";

const TODAY = "2026-11-18";

describe("relanceBody", () => {
  it.each([
    [{ date: "2026-12-01" }],
    [{ done: true }],
    [{ snoozeDays: 7 }],
    [{ snoozeDays: 1 }],
    [{ snoozeDays: 365 }],
    [{ restore: "2026-11-01" }],
    [{ restore: null }],
  ])("accepte %j", (b) => {
    expect(relanceBody.safeParse(b).success).toBe(true);
  });
  it.each([
    [{ snoozeDays: -1 }],
    [{ snoozeDays: 0 }],
    [{ snoozeDays: 1.5 }],
    [{ snoozeDays: 366 }],
    [{}],
    [{ done: false }],
    [{ date: "2026-12-01", done: true }],
    [{ done: true, snoozeDays: 3 }],
    [{ date: 5 }],
    [{ restore: 5 }],
  ])("rejette %j", (b) => {
    expect(relanceBody.safeParse(b).success).toBe(false);
  });
});

describe("computeRelanceCell", () => {
  it("date passée : past_date", () => {
    expect(computeRelanceCell({ date: "2026-11-17" }, null, TODAY)).toEqual({ ok: false, code: "past_date" });
  });
  it("date du jour ou future : acceptée", () => {
    expect(computeRelanceCell({ date: TODAY }, null, TODAY)).toEqual({ ok: true, value: TODAY });
    expect(computeRelanceCell({ date: "2026-12-01" }, "2026-11-20", TODAY)).toEqual({ ok: true, value: "2026-12-01" });
  });
  it("date impossible : invalid", () => {
    expect(computeRelanceCell({ date: "2026-02-30" }, null, TODAY)).toEqual({ ok: false, code: "invalid" });
    expect(computeRelanceCell({ date: "nimporte" }, null, TODAY)).toEqual({ ok: false, code: "invalid" });
  });
  it("faite : null", () => {
    expect(computeRelanceCell({ done: true }, "2026-11-20", TODAY)).toEqual({ ok: true, value: null });
    expect(computeRelanceCell({ done: true }, null, TODAY)).toEqual({ ok: true, value: null });
  });
  it("reporter : max(relance, aujourd'hui) + jours", () => {
    expect(computeRelanceCell({ snoozeDays: 7 }, "2026-11-10", TODAY)).toEqual({ ok: true, value: "2026-11-25" });
    expect(computeRelanceCell({ snoozeDays: 7 }, "2026-11-20", TODAY)).toEqual({ ok: true, value: "2026-11-27" });
  });
  it("reporter sans relance : no_relance", () => {
    expect(computeRelanceCell({ snoozeDays: 7 }, null, TODAY)).toEqual({ ok: false, code: "no_relance" });
  });
  it("restore : date passée acceptée, null accepté, date impossible invalid", () => {
    expect(computeRelanceCell({ restore: "2026-11-01" }, "2026-12-01", TODAY)).toEqual({ ok: true, value: "2026-11-01" });
    expect(computeRelanceCell({ restore: null }, "2026-12-01", TODAY)).toEqual({ ok: true, value: null });
    expect(computeRelanceCell({ restore: "2026-02-30" }, null, TODAY)).toEqual({ ok: false, code: "invalid" });
  });
});
