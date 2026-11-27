// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { refreshCrmData, useCrmContacts, useCrmDossiers, useCrmPipeline, useCrmRelances, useCrmRelancesCount } from "../use-crm-data";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

function stubFetch(ok = true) {
  const f = vi.fn(async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ count: 3 }) }));
  vi.stubGlobal("fetch", f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("hooks de données CRM", () => {
  it("pipeline : transmet filtres et fuseau", async () => {
    const f = stubFetch();
    const { result } = renderHook(() => useCrmPipeline({ mine: true, late: false, ownerId: "u1" }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const url = String((f.mock.calls[0] as unknown[])[0]);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(url).toContain("/api/crm/pipeline?");
    expect(url).toContain("mine=1");
    expect(url).not.toContain("late");
    expect(url).toContain("ownerId=u1");
    expect(url).toContain(`tz=${encodeURIComponent(tz)}`);
  });

  it("relances, contacts, dossiers et compteur ciblent leur route", async () => {
    const f = stubFetch();
    renderHook(() => useCrmRelances({ horizon: 14, mine: true }), { wrapper });
    renderHook(() => useCrmContacts(" ana "), { wrapper });
    renderHook(() => useCrmDossiers(), { wrapper });
    const count = renderHook(() => useCrmRelancesCount(), { wrapper });
    await waitFor(() => expect(count.result.current.data).toEqual({ count: 3 }));
    const urls = f.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.startsWith("/api/crm/relances?") && u.includes("horizon=14") && u.includes("mine=1"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/crm/contacts?") && u.includes("search=ana"))).toBe(true);
    expect(urls).toContain("/api/crm/dossiers");
    expect(urls.some((u) => u.startsWith("/api/crm/relances/count?"))).toBe(true);
  });

  it("une réponse non ok produit une erreur", async () => {
    stubFetch(false);
    const { result } = renderHook(() => useCrmDossiers(), { wrapper });
    await waitFor(() => expect(result.current.error).toBeTruthy());
  });

  it("refreshCrmData revalide les clés de données", async () => {
    const f = stubFetch();
    const { result } = renderHook(() => useCrmDossiers());
    await waitFor(() => expect(result.current.data).toBeTruthy());
    const before = f.mock.calls.length;
    await refreshCrmData();
    expect(f.mock.calls.length).toBeGreaterThan(before);
  });
});
