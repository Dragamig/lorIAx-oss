// @vitest-environment jsdom
/**
 * T9 : hook de données des modèles de présentation.
 * Couvre les états loading / error / vide / ok, le filtre Tous / LorIAx /
 * Organisation, les appels HTTP des actions et le rafraîchissement après une
 * action réussie (et seulement après une action réussie).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

vi.mock("swr", () => ({
  default: vi.fn(),
}));

import useSWR from "swr";
import { useTemplates } from "@/components/presentations/templates/use-templates";

const mockedUseSWR = vi.mocked(useSWR);

const lorIAxTpl = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Pitch produit",
  templateDescription: "Présenter une offre",
  templateOrigin: "lorIAx",
  templateSeedKey: "pitch",
  templateHiddenAt: null,
  version: 3,
};
const orgTpl = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Modèle maison",
  templateDescription: null,
  templateOrigin: null,
  templateSeedKey: null,
  templateHiddenAt: null,
  version: 1,
};

const mutate = vi.fn();

function mockSWR(state: { data?: unknown; isLoading?: boolean; error?: unknown }) {
  mockedUseSWR.mockReturnValue({
    data: state.data,
    isLoading: state.isLoading ?? false,
    error: state.error,
    mutate,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function okResponse(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as Response;
}

function errorResponse(status: number, body: unknown) {
  return { ok: false, status, json: async () => body } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mutate.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockSWR({ data: { templates: [lorIAxTpl, orgTpl] } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("états de chargement", () => {
  it("isLoading vrai et liste vide pendant le premier chargement", () => {
    mockSWR({ data: undefined, isLoading: true });
    const { result } = renderHook(() => useTemplates());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.templates).toEqual([]);
    expect(result.current.error).toBe(false);
    expect(result.current.isEmpty).toBe(false);
  });

  it("lit la liste sur la route de l'organisation", () => {
    renderHook(() => useTemplates());
    expect(mockedUseSWR.mock.calls[0][0]).toBe("/api/presentations/templates");
  });
});

describe("état d'erreur", () => {
  it("error vrai et isLoading faux quand la lecture échoue", () => {
    mockSWR({ data: undefined, isLoading: false, error: new Error("boom") });
    const { result } = renderHook(() => useTemplates());
    expect(result.current.error).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.templates).toEqual([]);
  });
});

describe("état vide", () => {
  it("isEmpty vrai quand la réponse ne contient aucun modèle", () => {
    mockSWR({ data: { templates: [] } });
    const { result } = renderHook(() => useTemplates());
    expect(result.current.isEmpty).toBe(true);
    expect(result.current.error).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("isEmpty vrai pour un filtre qui ne retient aucun modèle", () => {
    mockSWR({ data: { templates: [lorIAxTpl] } });
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.setFilter("organization"));
    expect(result.current.templates).toEqual([]);
    expect(result.current.isEmpty).toBe(true);
  });
});

describe("filtre Tous / LorIAx / Organisation", () => {
  it("affiche tous les modèles par défaut", () => {
    const { result } = renderHook(() => useTemplates());
    expect(result.current.filter).toBe("all");
    expect(result.current.templates.map((t) => t.id)).toEqual([lorIAxTpl.id, orgTpl.id]);
  });

  it("LorIAx ne garde que les modèles d'origine lorIAx", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.setFilter("lorIAx"));
    expect(result.current.templates.map((t) => t.id)).toEqual([lorIAxTpl.id]);
  });

  it("Organisation ne garde que les modèles sans origine LorIAx", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.setFilter("organization"));
    expect(result.current.templates.map((t) => t.id)).toEqual([orgTpl.id]);
  });

  it("le filtre ne modifie pas la liste complète exposée", () => {
    const { result } = renderHook(() => useTemplates());
    act(() => result.current.setFilter("lorIAx"));
    expect(result.current.allTemplates).toHaveLength(2);
  });
});

describe("action use", () => {
  it("POST /api/presentations avec templateId et spaceId, renvoie la présentation créée", async () => {
    const created = { id: "p-new", title: "Pitch produit" };
    fetchMock.mockResolvedValueOnce(okResponse(created, 201));
    const { result } = renderHook(() => useTemplates());

    let res: Awaited<ReturnType<typeof result.current.use>> | undefined;
    await act(async () => {
      res = await result.current.use(lorIAxTpl.id, "space-1");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/presentations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ templateId: lorIAxTpl.id, spaceId: "space-1" });
    expect(res).toEqual({ ok: true, presentation: created });
  });

  it("rend une erreur typée sans rafraîchir la liste", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404, { error: "Introuvable" }));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.use(lorIAxTpl.id, "space-1");
    });

    expect(res).toEqual({ ok: false, status: 404, error: "Introuvable" });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("action saveAsTemplate", () => {
  it("POST /api/presentations/[id]/template avec nom et description, puis rafraîchit", async () => {
    const copy = { id: "t-copy", isTemplate: true };
    fetchMock.mockResolvedValueOnce(okResponse({ template: copy }, 201));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.saveAsTemplate("p-src", { name: "Mon modèle", description: "Desc" });
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/presentations/p-src/template");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ name: "Mon modèle", description: "Desc" });
    expect(res).toEqual({ ok: true, template: copy });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("renvoie 409 tel quel quand la source n'a pas de contenu", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(409, { error: "pas de contenu" }));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.saveAsTemplate("p-src", { name: "X" });
    });

    expect(res).toEqual({ ok: false, status: 409, error: "pas de contenu" });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("masquage, démasquage et retrait", () => {
  it("hide envoie PATCH hidden: true puis rafraîchit", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ template: { ...orgTpl } }));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.hide(orgTpl.id);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/presentations/templates/${orgTpl.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ hidden: true });
    expect(res).toEqual({ ok: true, template: { ...orgTpl } });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("unhide envoie PATCH hidden: false", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ template: { ...orgTpl } }));
    const { result } = renderHook(() => useTemplates());

    await act(async () => {
      await result.current.unhide(orgTpl.id);
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ hidden: false });
  });

  it("retire envoie DELETE (masquage côté serveur) puis rafraîchit", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ template: { ...orgTpl } }));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.retire(orgTpl.id);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/presentations/templates/${orgTpl.id}`);
    expect(init.method).toBe("DELETE");
    expect(res).toEqual({ ok: true, template: { ...orgTpl } });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("une erreur de masquage est typée et ne rafraîchit pas", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, { error: "Accès refusé" }));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.hide(orgTpl.id);
    });

    expect(res).toEqual({ ok: false, status: 403, error: "Accès refusé" });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("action reset", () => {
  it("POST reset avec expectedVersion, puis rafraîchit", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ template: { ...lorIAxTpl, version: 4 } }));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.reset(lorIAxTpl.id, 3);
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/presentations/templates/${lorIAxTpl.id}/reset`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ expectedVersion: 3 });
    expect(res).toEqual({ ok: true, template: { ...lorIAxTpl, version: 4 } });
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("un conflit de version (409) remonte la version courante", async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(409, { error: "Conflit de version", currentVersion: 5 })
    );
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.reset(lorIAxTpl.id, 3);
    });

    expect(res).toEqual({
      ok: false,
      status: 409,
      error: "Conflit de version",
      currentVersion: 5,
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("erreur réseau", () => {
  it("fetch qui rejette donne status 0 et un message, sans lever d'exception", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.hide(orgTpl.id);
    });

    expect(res).toMatchObject({ ok: false, status: 0 });
    expect((res as { error: string }).error).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("une réponse d'erreur sans corps JSON garde un message générique", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected end of JSON");
      },
    } as unknown as Response);
    const { result } = renderHook(() => useTemplates());

    let res: unknown;
    await act(async () => {
      res = await result.current.reset(lorIAxTpl.id);
    });

    expect(res).toMatchObject({ ok: false, status: 500 });
    expect((res as { error: string }).error).toBeTruthy();
  });
});

describe("rafraîchissement", () => {
  it("refresh délègue au mutate SWR", async () => {
    const { result } = renderHook(() => useTemplates());
    await act(async () => {
      await result.current.refresh();
    });
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
