// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function link(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  a.textContent = "x";
  document.body.appendChild(a);
  return a;
}

function click(el: Element, init: MouseEventInit = {}) {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(ev);
  return ev;
}

function beforeUnload() {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  push.mockReset();
});

describe("useUnsavedChangesGuard", () => {
  it("ne pose pas beforeunload si propre", () => {
    renderHook(() => useUnsavedChangesGuard(false));
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("appelle preventDefault sur beforeunload si dirty, puis retire quand propre", () => {
    const { rerender } = renderHook(({ d }) => useUnsavedChangesGuard(d), {
      initialProps: { d: true },
    });
    expect(beforeUnload().defaultPrevented).toBe(true);
    rerender({ d: false });
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  it("intercepte un lien interne si dirty et navigue a la confirmation", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    const a = link("/fr/admin/autre");
    let ev!: MouseEvent;
    act(() => {
      ev = click(a);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(result.current.confirmOpen).toBe(true);
    expect(result.current.pendingHref).toBe("/fr/admin/autre");
    act(() => result.current.confirmLeave());
    expect(push).toHaveBeenCalledWith("/fr/admin/autre");
    expect(result.current.confirmOpen).toBe(false);
  });

  it("cancelLeave ferme la confirmation", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    act(() => {
      click(link("/fr/x"));
    });
    act(() => result.current.cancelLeave());
    expect(result.current.confirmOpen).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("laisse passer un lien interne si propre", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(false));
    const ev = click(link("/fr/x"));
    expect(ev.defaultPrevented).toBe(false);
    expect(result.current.confirmOpen).toBe(false);
  });

  it("laisse passer lien externe, ctrl, target _blank et hash", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    expect(click(link("https://example.com/")).defaultPrevented).toBe(false);
    expect(click(link("/fr/x"), { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(click(link("/fr/y", { target: "_blank" })).defaultPrevented).toBe(false);
    expect(click(link("#ancre")).defaultPrevented).toBe(false);
    expect(result.current.confirmOpen).toBe(false);
  });

  it("nettoie les ecouteurs au demontage", () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true));
    unmount();
    expect(beforeUnload().defaultPrevented).toBe(false);
    expect(click(link("/fr/x")).defaultPrevented).toBe(false);
  });

  it("ignore un lien marque data-unsaved-guard=ignore ou dans un tel conteneur", () => {
    const { result } = renderHook(() => useUnsavedChangesGuard(true));
    const a = link("/fr/admin/autre", { "data-unsaved-guard": "ignore" });
    const wrap = document.createElement("div");
    wrap.setAttribute("data-unsaved-guard", "ignore");
    const b = document.createElement("a");
    b.setAttribute("href", "/fr/admin/autre2");
    wrap.appendChild(b);
    document.body.appendChild(wrap);
    let e1!: MouseEvent;
    let e2!: MouseEvent;
    act(() => {
      e1 = click(a);
      e2 = click(b);
    });
    expect(e1.defaultPrevented).toBe(false);
    expect(e2.defaultPrevented).toBe(false);
    expect(result.current.confirmOpen).toBe(false);
  });

  it("remet le contournement a false apres la navigation", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useUnsavedChangesGuard(true));
      const a = link("/fr/admin/autre");
      act(() => {
        click(a);
      });
      act(() => result.current.confirmLeave());
      expect(push).toHaveBeenCalledWith("/fr/admin/autre");
      let ev!: MouseEvent;
      act(() => {
        ev = click(a);
      });
      expect(ev.defaultPrevented).toBe(false); // contournement actif
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      act(() => {
        ev = click(a);
      });
      expect(ev.defaultPrevented).toBe(true); // garde reactivee
    } finally {
      vi.useRealTimers();
    }
  });
});
