// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { DbRow } from "@/components/editor/extensions/database-block/types";

let currentSearch = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { useRecordSheet } from "@/components/bases/use-record-sheet";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";
const U4 = "44444444-4444-4444-8444-444444444444";

function row(id: string, position: number): DbRow {
  return {
    id,
    databaseId: "db",
    cells: {},
    position,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const rows = [row(U1, 0), row(U2, 1), row(U3, 2)];
const ids = [U1, U2, U3];

beforeEach(() => {
  currentSearch = "";
  window.history.replaceState(null, "", "/bases/x");
});
afterEach(() => vi.restoreAllMocks());

describe("useRecordSheet", () => {
  it("starts closed without a row param", () => {
    const { result } = renderHook(() => useRecordSheet({ rows, orderedIds: ids }));
    expect(result.current.status).toBe("closed");
    expect(result.current.openRow).toBeNull();
  });

  it("opens from a valid row param", () => {
    currentSearch = `row=${U2}`;
    const { result } = renderHook(() => useRecordSheet({ rows, orderedIds: ids }));
    expect(result.current.status).toBe("ready");
    expect(result.current.openRow?.id).toBe(U2);
    expect(result.current.nav).toEqual({ index: 1, total: 3, prevId: U1, nextId: U3, outOfList: false });
  });

  it("shows notFound for an unknown or invalid row param", () => {
    currentSearch = `row=${U4}`;
    const a = renderHook(() => useRecordSheet({ rows, orderedIds: ids }));
    expect(a.result.current.status).toBe("notFound");
    expect(a.result.current.openRow).toBeNull();
    expect(a.result.current.nav).toBeNull();

    currentSearch = "row=abc";
    const b = renderHook(() => useRecordSheet({ rows, orderedIds: ids }));
    expect(b.result.current.status).toBe("notFound");
    expect(b.result.current.openRow).toBeNull();
    expect(b.result.current.nav).toBeNull();
    act(() => b.result.current.closeRecord());
    expect(b.result.current.status).toBe("closed");
  });

  it("updates the url with replaceState on open, navigate and close", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    const push = vi.spyOn(window.history, "pushState");
    const { result } = renderHook(() => useRecordSheet({ rows, orderedIds: ids }));
    act(() => result.current.openRecord(U1));
    act(() => result.current.navigate(U2));
    act(() => result.current.closeRecord());
    const urls = replace.mock.calls.map((c) => String(c[2]));
    expect(urls[0]).toContain(`row=${U1}`);
    expect(urls[1]).toContain(`row=${U2}`);
    expect(urls[2]).not.toContain("row");
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps navigating from the previous position when the open row leaves the view", () => {
    const { result, rerender } = renderHook(
      (p: { orderedIds: string[] }) => useRecordSheet({ rows, orderedIds: p.orderedIds }),
      { initialProps: { orderedIds: ids } },
    );
    act(() => result.current.openRecord(U2));
    rerender({ orderedIds: [U1, U3] });
    expect(result.current.status).toBe("ready");
    expect(result.current.nav).toEqual({ index: 1, total: 2, prevId: U1, nextId: U3, outOfList: true });
  });

  it("switches to notFound when the open row disappears from the base", () => {
    const { result, rerender } = renderHook(
      (p: { rows: DbRow[] }) => useRecordSheet({ rows: p.rows, orderedIds: ids }),
      { initialProps: { rows } },
    );
    act(() => result.current.openRecord(U2));
    rerender({ rows: [rows[0], rows[2]] });
    expect(result.current.status).toBe("notFound");
  });

  it("follows a row param change on the same page", () => {
    currentSearch = `row=${U1}`;
    const { result, rerender } = renderHook(() => useRecordSheet({ rows, orderedIds: ids }));
    expect(result.current.openRowId).toBe(U1);
    currentSearch = `row=${U3}`;
    rerender();
    expect(result.current.openRowId).toBe(U3);
  });

  it("ignores a late stale param echo of its own writes", () => {
    const { result, rerender } = renderHook(() => useRecordSheet({ rows, orderedIds: ids }));
    act(() => result.current.openRecord(U1));
    act(() => result.current.navigate(U2));
    currentSearch = `row=${U1}`;
    rerender();
    expect(result.current.openRowId).toBe(U2);
    currentSearch = `row=${U2}`;
    rerender();
    expect(result.current.openRowId).toBe(U2);
  });

  it("restarts navigation from the first row when a linked row is out of the list", () => {
    const all = [...rows, row(U4, 3)];
    const { result, rerender } = renderHook(() => useRecordSheet({ rows: all, orderedIds: ids }));
    act(() => result.current.openRecord(U3));
    currentSearch = `row=${U4}`;
    rerender();
    expect(result.current.openRowId).toBe(U4);
    expect(result.current.nav).toEqual({ index: 0, total: 3, prevId: null, nextId: U1, outOfList: true });
  });
});
