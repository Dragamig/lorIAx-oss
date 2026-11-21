/**
 * Cloisonnement multi-tenant du module réunions, audit AZ-19 et AZ-10.
 *
 * AZ-19 : les réunions étaient chargées par identifiant (ou par nom de salle)
 * sans aucun filtre d'organisation, et le DELETE accordait le droit à tout rôle
 * global `admin`. Un admin d'un tenant supprimait donc la réunion planifiée
 * d'un autre tenant, ou obtenait un jeton LiveKit `roomJoin+canPublish` sur sa
 * salle. Les routes passent désormais par `getMeetingInOrg` /
 * `getMeetingByRoomNameInOrg`, avec l'organisation de la requête en paramètre
 * explicite : l'organisation d'abord, la dispense de rôle ensuite.
 *
 * AZ-10 : `start-recording` ne contrôlait que la présence d'une session. Tout
 * compte connaissant l'identifiant d'une réunion la faisait enregistrer par
 * LiveKit Egress. Le contrôle d'accès (`canAccessMeeting`) est désormais exigé.
 *
 * Motif des assertions : « refuse ET ne fait rien ». Le statut ne suffit pas,
 * l'absence d'effet est prouvée par le non-appel des effets externes (jeton
 * LiveKit émis, Egress démarré, suppression en base).
 *
 * FACTURE DU HARNAIS. Les doublures conservent l'implémentation réelle des
 * exports non pilotés (`importOriginal`) et exposent AUSSI les noms d'avant le
 * lot (`getMeeting`, `getMeetingByRoomName`), avec leur sémantique d'origine :
 * aucun filtre d'organisation. Rétablir les routes dans leur version d'avant
 * le lot fait donc rougir ces tests sur une ASSERTION, jamais sur un export
 * manquant. De même, `canAccessMeeting` accepte les deux signatures, l'ancienne
 * (identifiant seul, rôle global relu en base) et la nouvelle (session).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  // Réunion planifiée du tenant B, telle qu'elle existe en base
  meeting: {
    id: "meeting-b",
    roomName: "2026-01-01_reunion-b_abcdef",
    createdBy: "organisateur-b",
    spaceId: "space-b",
    organizationId: "org-b",
    status: "scheduled" as string,
    egressId: null as string | null,
    title: "Réunion du tenant B",
    calendarEventId: null as string | null,
  },
  // Utilisateurs considérés comme administrateurs de l'espace de la réunion
  spaceAdmins: [] as string[],
  // Organisation résolue pour la requête courante (sous-domaine)
  requestOrgId: null as string | null,
  sessionUser: null as { id: string; globalRole: string; name?: string; email?: string } | null,
}));

/**
 * Faux client Drizzle qui répond PAR TABLE et non par rang d'appel : le nombre
 * et l'ordre des requêtes peuvent changer d'une version de l'implémentation à
 * l'autre sans casser le harnais.
 */
const DRIZZLE_NAME = Symbol.for("drizzle:Name");

vi.mock("@/lib/db", () => {
  const nomTable = (table: unknown): string =>
    (table as Record<symbol, string> | null | undefined)?.[DRIZZLE_NAME] ?? "";

  const lignesPour = (table: unknown): unknown[] => {
    switch (nomTable(table)) {
      case "meetings":
        return [state.meeting];
      case "users":
        return state.sessionUser ? [state.sessionUser] : [];
      // Participants, permissions d'espace, événements de calendrier : vides.
      default:
        return [];
    }
  };

  const chaine = (table?: unknown) => {
    let lignes: unknown[] = table === undefined ? [] : lignesPour(table);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: (t: unknown) => {
        lignes = lignesPour(t);
        return self;
      },
      innerJoin: () => self,
      leftJoin: () => self,
      where: () => self,
      set: () => self,
      values: () => self,
      orderBy: () => self,
      groupBy: () => self,
      limit: () => Promise.resolve(lignes),
      returning: () => Promise.resolve(lignes),
      then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
        Promise.resolve(lignes).then(resoudre, rejeter),
    };
    return self;
  };

  return {
    db: {
      select: () => chaine(),
      update: (t: unknown) => chaine(t),
      delete: (t: unknown) => chaine(t),
      insert: (t: unknown) => chaine(t),
      execute: () => Promise.resolve({ rows: [] }),
    },
  };
});

// `@/lib/auth/get-user` n'est pas rechargé par `importOriginal` : son module
// réel tire next-auth, non chargeable sous vitest. Il n'expose qu'un export
// utile ici, stable de part et d'autre du lot.
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => state.sessionUser),
}));

vi.mock("@/lib/org/get-request-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/get-request-org")>()),
  getRequestOrgId: vi.fn(async () => state.requestOrgId),
}));

vi.mock("@/lib/auth/check-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/check-access")>()),
  getSpacePermission: vi.fn(async (userId: string) =>
    state.spaceAdmins.includes(userId) ? "admin" : null
  ),
}));

/**
 * Résout l'acteur quelle que soit la signature de `canAccessMeeting` :
 * l'implémentation d'avant le lot recevait un identifiant seul et relisait le
 * rôle global en base, celle d'après reçoit la session complète.
 */
const acteurDe = (acteur: unknown): { id: string; globalRole: string } => {
  if (typeof acteur === "string") {
    return { id: acteur, globalRole: state.sessionUser?.globalRole ?? "viewer" };
  }
  return acteur as { id: string; globalRole: string };
};

const estAdminGlobal = (role: string) => role === "admin" || role === "super_admin";

/**
 * Faux module réunions. Les variantes confinées appliquent réellement le filtre
 * d'organisation, les variantes non confinées (noms d'avant le lot inclus)
 * conservent le comportement d'origine : elles rendent la réunion sans regarder
 * l'organisation. Tout export non listé garde son implémentation réelle.
 */
vi.mock("@/lib/meet/rooms", async (importOriginal) => {
  const parId = async (id: string) => (id === state.meeting.id ? state.meeting : null);
  const parSalle = async (roomName: string) =>
    roomName === state.meeting.roomName ? state.meeting : null;
  const parIdDansOrg = async (id: string, orgId: string) =>
    id === state.meeting.id && orgId === state.meeting.organizationId ? state.meeting : null;
  const parSalleDansOrg = async (roomName: string, orgId: string) =>
    roomName === state.meeting.roomName && orgId === state.meeting.organizationId
      ? state.meeting
      : null;

  return {
    ...(await importOriginal<typeof import("@/lib/meet/rooms")>()),
    // Noms d'avant le lot : aucun filtre d'organisation.
    getMeeting: vi.fn(parId),
    getMeetingByRoomName: vi.fn(parSalle),
    // Noms actuels de la variante non confinée, même sémantique.
    getMeetingUnscoped: vi.fn(parId),
    getMeetingByRoomNameUnscoped: vi.fn(parSalle),
    // Variantes confinées à l'organisation.
    getMeetingInOrg: vi.fn(parIdDansOrg),
    getMeetingByRoomNameInOrg: vi.fn(parSalleDansOrg),
    canAccessMeeting: vi.fn(
      async (acteur: unknown, meeting: { createdBy: string | null }) => {
        const u = acteurDe(acteur);
        return (
          meeting.createdBy === u.id ||
          state.spaceAdmins.includes(u.id) ||
          estAdminGlobal(u.globalRole)
        );
      }
    ),
    getMeetingParticipants: vi.fn(async () => []),
    updateMeetingTitle: vi.fn(async () => state.meeting),
    updateMeetingStatus: vi.fn(async () => state.meeting),
    deleteMeeting: vi.fn(async () => state.meeting),
  };
});

vi.mock("@/lib/meet/egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meet/egress")>()),
  startRecording: vi.fn(async () => "egress-1"),
}));

vi.mock("@/lib/meet/livekit-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meet/livekit-config")>()),
  getLiveKitConfig: vi.fn(async () => ({
    livekitApiKey: "key",
    livekitApiSecret: "secret",
  })),
}));

vi.mock("@/lib/meet/livekit-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meet/livekit-token")>()),
  generateLiveKitToken: vi.fn(async () => "jeton-livekit"),
}));

import { deleteMeeting } from "@/lib/meet/rooms";
import { startRecording } from "@/lib/meet/egress";
import { generateLiveKitToken } from "@/lib/meet/livekit-token";

const mockDelete = vi.mocked(deleteMeeting);
const mockStartRecording = vi.mocked(startRecording);
const mockToken = vi.mocked(generateLiveKitToken);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  state.meeting = {
    id: "meeting-b",
    roomName: "2026-01-01_reunion-b_abcdef",
    createdBy: "organisateur-b",
    spaceId: "space-b",
    organizationId: "org-b",
    status: "scheduled",
    egressId: null,
    title: "Réunion du tenant B",
    calendarEventId: null,
  };
  state.spaceAdmins = [];
  state.requestOrgId = null;
  state.sessionUser = null;
});

describe("DELETE /api/meet/rooms/[id] : cloisonnement (AZ-19)", () => {
  it("404 muet et aucune suppression pour un admin global d'un autre tenant", async () => {
    state.sessionUser = { id: "admin-a", globalRole: "admin" };
    state.requestOrgId = "org-a";

    const { DELETE } = await import("@/app/api/meet/rooms/[id]/route");
    const res = await DELETE(
      new NextRequest("http://localhost/x", { method: "DELETE" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(404);
    // Le message ne doit pas révéler l'existence d'une réunion d'un autre tenant
    expect((await res.json()).error).toBe("Réunion introuvable");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("404 et aucune suppression quand l'organisation n'est pas résolue", async () => {
    state.sessionUser = { id: "admin-a", globalRole: "admin" };
    state.requestOrgId = null; // fail-closed

    const { DELETE } = await import("@/app/api/meet/rooms/[id]/route");
    const res = await DELETE(
      new NextRequest("http://localhost/x", { method: "DELETE" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(404);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("chemin passant : l'organisateur supprime sa réunion planifiée", async () => {
    state.sessionUser = { id: "organisateur-b", globalRole: "editor" };
    state.requestOrgId = "org-b";

    const { DELETE } = await import("@/app/api/meet/rooms/[id]/route");
    const res = await DELETE(
      new NextRequest("http://localhost/x", { method: "DELETE" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith("meeting-b");
  });

  it("chemin passant : un admin de l'espace de la bonne organisation supprime", async () => {
    state.sessionUser = { id: "admin-espace-b", globalRole: "editor" };
    state.requestOrgId = "org-b";
    state.spaceAdmins = ["admin-espace-b"];

    const { DELETE } = await import("@/app/api/meet/rooms/[id]/route");
    const res = await DELETE(
      new NextRequest("http://localhost/x", { method: "DELETE" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith("meeting-b");
  });
});

describe("POST /api/meet/token : cloisonnement (AZ-19)", () => {
  const req = (roomName: string) =>
    new NextRequest("http://localhost/api/meet/token", {
      method: "POST",
      body: JSON.stringify({ roomName }),
      headers: { "content-type": "application/json" },
    });

  it("refuse et n'émet aucun jeton LiveKit pour un admin global d'un autre tenant", async () => {
    state.sessionUser = {
      id: "admin-a",
      globalRole: "admin",
      name: "Admin A",
      email: "admin@org-a.test",
    };
    state.requestOrgId = "org-a";

    const { POST } = await import("@/app/api/meet/token/route");
    const res = await POST(req(state.meeting.roomName));

    expect(res.status).toBe(404);
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("chemin passant : l'organisateur obtient un jeton pour sa salle", async () => {
    state.sessionUser = {
      id: "organisateur-b",
      globalRole: "editor",
      name: "Organisateur B",
      email: "orga@org-b.test",
    };
    state.requestOrgId = "org-b";

    const { POST } = await import("@/app/api/meet/token/route");
    const res = await POST(req(state.meeting.roomName));

    expect(res.status).toBe(200);
    expect(mockToken).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/meet/rooms/[id]/start-recording : contrôle d'accès (AZ-10)", () => {
  beforeEach(() => {
    state.meeting.status = "active";
  });

  it("refuse et ne démarre aucun Egress pour un compte quelconque de la bonne organisation", async () => {
    // Même organisation que la réunion : le cloisonnement ne suffit pas ici,
    // c'est bien le contrôle d'accès qui doit refuser.
    state.sessionUser = { id: "curieux-b", globalRole: "editor" };
    state.requestOrgId = "org-b";

    const { POST } = await import(
      "@/app/api/meet/rooms/[id]/start-recording/route"
    );
    const res = await POST(
      new NextRequest("http://localhost/x", { method: "POST" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(403);
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it("404 et aucun Egress pour un compte d'un autre tenant", async () => {
    state.sessionUser = { id: "admin-a", globalRole: "admin" };
    state.requestOrgId = "org-a";

    const { POST } = await import(
      "@/app/api/meet/rooms/[id]/start-recording/route"
    );
    const res = await POST(
      new NextRequest("http://localhost/x", { method: "POST" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(404);
    expect(mockStartRecording).not.toHaveBeenCalled();
  });

  it("chemin passant : l'organisateur lance l'enregistrement", async () => {
    state.sessionUser = { id: "organisateur-b", globalRole: "editor" };
    state.requestOrgId = "org-b";

    const { POST } = await import(
      "@/app/api/meet/rooms/[id]/start-recording/route"
    );
    const res = await POST(
      new NextRequest("http://localhost/x", { method: "POST" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(200);
    expect(mockStartRecording).toHaveBeenCalledWith(state.meeting.roomName);
  });

  it("chemin passant : un admin de l'espace lance l'enregistrement", async () => {
    state.sessionUser = { id: "admin-espace-b", globalRole: "editor" };
    state.requestOrgId = "org-b";
    state.spaceAdmins = ["admin-espace-b"];

    const { POST } = await import(
      "@/app/api/meet/rooms/[id]/start-recording/route"
    );
    const res = await POST(
      new NextRequest("http://localhost/x", { method: "POST" }) as never,
      ctx("meeting-b")
    );

    expect(res.status).toBe(200);
    expect(mockStartRecording).toHaveBeenCalledTimes(1);
  });
});
