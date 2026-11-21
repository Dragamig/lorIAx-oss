/**
 * AZ-20 : DELETE /api/calendar-feeds
 *
 * Le DELETE supprimait par identifiant seul, sans filtre `userId`, alors que le
 * GET et le POST de la même route filtrent bien : deviner un identifiant de
 * flux suffisait à supprimer l'abonnement calendrier d'un autre utilisateur.
 *
 * Le correctif porte la condition d'appartenance dans la clause `where` de la
 * suppression elle-même (pas de test préalable, donc pas de fenêtre entre la
 * vérification et l'effacement). Le test le prouve en inspectant la clause
 * transmise à Drizzle et en simulant une suppression qui ne touche rien.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let deletedRows: unknown[] = [];
const deleteWhere = vi.fn();

const returning = vi.fn(() => Promise.resolve(deletedRows));

const makeDbMock = () => ({
  delete: vi.fn(() => ({
    where: (clause: unknown) => {
      deleteWhere(clause);
      return { returning };
    },
  })),
});

vi.mock("@/lib/db", () => ({ db: makeDbMock() }));

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { calendarExternalFeeds } from "@/lib/db/schema";

const mockUser = vi.mocked(getSessionUser);

const req = (id: string) =>
  new Request("http://localhost/api/calendar-feeds", {
    method: "DELETE",
    body: JSON.stringify({ id }),
    headers: { "content-type": "application/json" },
  });

/** Aplatit une clause Drizzle en une liste de valeurs de paramètres. */
function parametres(chunk: unknown): unknown[] {
  if (chunk === null || typeof chunk !== "object") return [chunk];
  const obj = chunk as Record<string, unknown>;
  if (Array.isArray(obj.queryChunks)) {
    return obj.queryChunks.flatMap((c) => parametres(c));
  }
  if (Array.isArray(obj.value)) return [];
  if (obj.value !== undefined) return parametres(obj.value);
  return [];
}

/** Colonnes référencées par une clause Drizzle. */
function colonnes(chunk: unknown): string[] {
  if (chunk === null || typeof chunk !== "object") return [];
  const obj = chunk as Record<string, unknown>;
  if (typeof obj.name === "string" && typeof obj.columnType === "string") {
    return [obj.name];
  }
  if (Array.isArray(obj.queryChunks)) {
    return obj.queryChunks.flatMap((c) => colonnes(c));
  }
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  deletedRows = [];
  mockUser.mockResolvedValue({
    id: "user-a",
    name: "Alice",
    email: "alice@org-a.com",
    globalRole: "editor",
  } as never);
});

describe("DELETE /api/calendar-feeds : appartenance dans la clause where", () => {
  it("contraint la suppression à l'identifiant ET au propriétaire", async () => {
    deletedRows = [{ id: "feed-1" }];
    const { DELETE } = await import("@/app/api/calendar-feeds/route");
    const res = await DELETE(req("feed-1"));
    expect(res.status).toBe(200);

    expect(deleteWhere).toHaveBeenCalledTimes(1);
    const clause = deleteWhere.mock.calls[0][0];
    // La colonne user_id fait partie de la clause de suppression elle-même.
    expect(colonnes(clause)).toContain(calendarExternalFeeds.userId.name);
    // Et l'identifiant de l'appelant est bien la valeur comparée.
    expect(parametres(clause)).toContain("user-a");
  });

  it("répond 404 sans rien supprimer quand le flux appartient à un autre utilisateur", async () => {
    // La suppression bornée au propriétaire ne renvoie aucune ligne.
    deletedRows = [];
    const { DELETE } = await import("@/app/api/calendar-feeds/route");
    const res = await DELETE(req("feed-de-bob"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Flux introuvable" });
  });

  it("répond 401 sans toucher à la base si la session est absente", async () => {
    mockUser.mockResolvedValueOnce(null as never);
    const { DELETE } = await import("@/app/api/calendar-feeds/route");
    const res = await DELETE(req("feed-1"));
    expect(res.status).toBe(401);
    expect(deleteWhere).not.toHaveBeenCalled();
  });
});
