/**
 * Non-régression : le téléchargement d'un modèle Ollama est une action
 * d'instance.
 *
 * `POST /api/admin/services/ollama-models` déclenche un `pull` sur le serveur
 * Ollama partagé par toute l'instance : disque et réseau consommés pour tous
 * les tenants, sur une ressource dont la configuration est réservée à
 * l'administration d'instance depuis le correctif AZ-08. La route était ouverte
 * au rôle `admin`, donc un administrateur d'organisation faisait travailler une
 * ressource qu'il ne peut plus configurer.
 *
 * Motif : « répond 403 ET ne fait rien », l'absence d'effet étant prouvée par
 * le non-appel de `fetch`, seule porte de sortie de la route.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self: any = {
        from: () => self,
        where: () => self,
        limit: () => Promise.resolve([]),
        then: (resolve: (v: unknown[]) => void) => Promise.resolve([]).then(resolve),
      };
      return self;
    },
  },
}));

import { POST } from "@/app/api/admin/services/ollama-models/route";

function requete() {
  return new NextRequest("http://localhost/api/admin/services/ollama-models", {
    method: "POST",
    body: JSON.stringify({ name: "llama3" }),
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

describe("POST /api/admin/services/ollama-models", () => {
  it("refuse un admin d'organisation, avec un message explicite, et ne sort pas", async () => {
    h.getSessionUser.mockResolvedValue({ id: "admin-1", globalRole: "admin" });

    const res = await POST(requete() as never);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Action réservée à l'administration d'instance",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse un éditeur et ne sort pas", async () => {
    h.getSessionUser.mockResolvedValue({ id: "user-1", globalRole: "editor" });

    const res = await POST(requete() as never);

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("laisse passer l'administration d'instance jusqu'à la requête sortante", async () => {
    h.getSessionUser.mockResolvedValue({ id: "super-1", globalRole: "super_admin" });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "success" }), { status: 200 })
    );

    const res = await POST(requete() as never);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
