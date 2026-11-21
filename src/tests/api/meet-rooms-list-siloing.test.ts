/**
 * Cloisonnement de la liste des réunions.
 *
 * `listMeetings(userId)` n'avait aucun filtre d'organisation : un utilisateur
 * membre de plusieurs organisations voyait dans `GET /api/meet/rooms` les
 * réunions de toutes ses organisations mélangées, y compris sur un
 * sous-domaine où elles n'ont rien à faire. Fuite de métadonnées (titre,
 * espace, horaires, statut), pas d'accès aux salles elles-mêmes.
 *
 * L'organisation est désormais un paramètre obligatoire de `listMeetings`,
 * résolu par la route via `getRequestOrgId`, `null` valant « aucun accès ».
 *
 * Le faux `listMeetings` applique RÉELLEMENT le filtre attendu, y compris la
 * règle des réunions orphelines : la table `meetings` ne porte pas
 * d'organisation, celle-ci est dérivée de l'espace, et l'espace peut être nul
 * (`onDelete: set null`). Une telle réunion n'est rattachable à aucune
 * organisation, elle est donc invisible, exactement comme dans
 * `getMeetingInOrg` dont la jointure interne fait déjà ce choix.
 *
 * Motif des assertions : « la réponse ne contient rien d'un autre tenant ».
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

interface FausseReunion {
  id: string;
  title: string;
  createdBy: string;
  spaceId: string | null;
  organizationId: string | null;
}

const state = vi.hoisted(() => ({
  requestOrgId: null as string | null,
  sessionUser: null as { id: string; globalRole: string } | null,
}));

/** Base de réunions du même utilisateur, réparties sur deux organisations. */
const REUNIONS: FausseReunion[] = [
  {
    id: "meeting-a",
    title: "Comité du tenant A",
    createdBy: "membre-multi",
    spaceId: "space-a",
    organizationId: "org-a",
  },
  {
    id: "meeting-b",
    title: "Revue budgétaire du tenant B",
    createdBy: "membre-multi",
    spaceId: "space-b",
    organizationId: "org-b",
  },
  {
    id: "meeting-orpheline",
    title: "Réunion dont l'espace a été supprimé",
    createdBy: "membre-multi",
    spaceId: null,
    organizationId: null,
  },
];

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => state.sessionUser),
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(async () => state.requestOrgId),
}));

vi.mock("@/lib/meet/rooms", () => ({
  createMeeting: vi.fn(),
  generateAutoTitle: vi.fn(async () => "titre"),
  // Reproduit la jointure interne sur `spaces` : une réunion sans espace, ou
  // dont l'espace relève d'une autre organisation, ne remonte jamais.
  //
  // Si l'appelant n'a pas passé d'organisation (signature d'avant correctif,
  // où le 2e argument était la limite), on rend délibérément la liste NON
  // filtrée : annuler le correctif dans la route fait alors rougir ces tests
  // pour la bonne raison, la fuite inter-organisation elle-même.
  listMeetings: vi.fn(
    async (userId: string, orgId: unknown, limit = 20) => {
      const mesReunions = REUNIONS.filter((m) => m.createdBy === userId);
      if (typeof orgId !== "string") {
        return mesReunions.slice(0, typeof orgId === "number" ? orgId : limit);
      }
      return mesReunions
        .filter((m) => m.organizationId !== null && m.organizationId === orgId)
        .slice(0, limit);
    }
  ),
}));

vi.mock("@/lib/meet/permissions", () => ({
  checkVisioPermission: vi.fn(async () => true),
}));

vi.mock("@/lib/onboarding/progress", () => ({
  recordOnboardingEvent: vi.fn(async () => undefined),
}));

vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) } }));

vi.mock("@/lib/auth/check-access", () => ({
  checkDocumentViewAccess: vi.fn(async () => false),
}));

import { listMeetings } from "@/lib/meet/rooms";

const mockList = vi.mocked(listMeetings);

const get = async () => {
  const { GET } = await import("@/app/api/meet/rooms/route");
  return GET(new NextRequest("http://localhost/api/meet/rooms") as never);
};

beforeEach(() => {
  vi.clearAllMocks();
  state.requestOrgId = null;
  state.sessionUser = null;
});

describe("GET /api/meet/rooms : cloisonnement de la liste", () => {
  it("sur le sous-domaine du tenant A, aucune réunion du tenant B", async () => {
    state.sessionUser = { id: "membre-multi", globalRole: "editor" };
    state.requestOrgId = "org-a";

    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as FausseReunion[];

    expect(body.map((m) => m.id)).toEqual(["meeting-a"]);
    // Aucune métadonnée d'un autre tenant, titre compris.
    expect(JSON.stringify(body)).not.toContain("tenant B");
    // L'organisation est passée explicitement, jamais devinée dans la lib.
    expect(mockList).toHaveBeenCalledWith("membre-multi", "org-a", 20);
  });

  it("sur le sous-domaine du tenant B, aucune réunion du tenant A", async () => {
    state.sessionUser = { id: "membre-multi", globalRole: "editor" };
    state.requestOrgId = "org-b";

    const body = (await (await get()).json()) as FausseReunion[];

    expect(body.map((m) => m.id)).toEqual(["meeting-b"]);
    expect(JSON.stringify(body)).not.toContain("tenant A");
  });

  it("liste vide quand aucune organisation n'est résolue (fail-closed)", async () => {
    state.sessionUser = { id: "membre-multi", globalRole: "admin" };
    state.requestOrgId = null;

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    // Rien n'est listé à l'aveugle : la lib n'est même pas sollicitée.
    expect(mockList).not.toHaveBeenCalled();
  });

  it("une réunion orpheline (espace supprimé) reste invisible, comme dans getMeetingInOrg", async () => {
    state.sessionUser = { id: "membre-multi", globalRole: "editor" };
    state.requestOrgId = "org-a";

    const body = (await (await get()).json()) as FausseReunion[];
    expect(body.some((m) => m.id === "meeting-orpheline")).toBe(false);
  });
});
