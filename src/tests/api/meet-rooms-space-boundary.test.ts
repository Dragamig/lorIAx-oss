/**
 * Frontière INTRA-organisation du module réunions.
 *
 * `getMeetingInOrg` / `getMeetingByRoomNameInOrg` bornent l'organisation, rien
 * de plus : elles ne regardent aucune permission d'espace. Tout membre de
 * l'organisation qui connaît un identifiant de réunion, ou un nom de salle,
 * obtient donc l'objet réunion complet si la route qui l'appelle ne pose pas
 * elle-même le contrôle. Cette suite fige la contrepartie : les ONZE
 * gestionnaires du module refusent un membre de l'organisation étranger à la
 * réunion et à son espace, et n'écrivent rien.
 *
 * L'invariant est vérifié route par route parce que le niveau exigé diffère
 * d'une route à l'autre (organisateur seul pour l'activation, la clôture, le
 * mapping et le renommage ; `canAccessMeeting` pour les lectures, le jeton et
 * l'enregistrement ; organisateur ou administrateur pour la suppression). Une
 * brique unique à la manière de `denyVideoSpaceAccess` écraserait cette échelle.
 * Le test la remplace : toute route nouvelle ou régressée qui oublierait son
 * contrôle rougit ici.
 *
 * FIDÉLITÉ DU HARNAIS. `@/lib/meet/rooms` n'est PAS doublé : la vraie
 * `canAccessMeeting` décide, sur un faux client Drizzle qui répond par table.
 * L'absence d'effet est prouvée par l'absence d'écriture réelle (aucun
 * `update` / `delete` / `insert` soumis) et par le non-appel des seuls effets
 * externes (Egress, jeton LiveKit). Les modules doublés le sont avec
 * `importOriginal()`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  meeting: {
    id: "meeting-b",
    roomName: "2026-01-01_reunion-b_abcdef",
    createdBy: "organisateur-b",
    spaceId: "space-prive-b",
    status: "active" as string,
    egressId: null as string | null,
    title: "Réunion du service B",
    notesDocumentId: null as string | null,
    transcriptPath: null as string | null,
    speakerMapping: null as unknown,
    calendarEventId: null as string | null,
    meetingType: "video" as string,
  },
  /** Utilisateurs administrateurs de l'espace porteur. */
  spaceAdmins: [] as string[],
  /** Identifiants inscrits comme participants de la réunion. */
  participants: [] as string[],
  requestOrgId: "org-b" as string | null,
  sessionUser: null as { id: string; globalRole: string; name?: string; email?: string } | null,
  /** Écritures réellement soumises au client Drizzle, par table. */
  ecritures: [] as { operation: string; table: string }[],
}));

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

vi.mock("@/lib/db", () => {
  const nomTable = (table: unknown): string =>
    (table as Record<symbol, string> | null | undefined)?.[DRIZZLE_NAME] ?? "";

  const lignesPour = (table: unknown): unknown[] => {
    switch (nomTable(table)) {
      case "meetings":
        // Deux formes de projection cohabitent sur cette table : la sélection
        // brute des routes, et `select({ meeting: meetings })` des chargements
        // confinés. La ligne porte les deux, le harnais reste indifférent à la
        // projection choisie par l'implémentation.
        return [{ ...state.meeting, meeting: state.meeting }];
      case "meeting_participants":
        // La clause `where` réelle filtre sur l'utilisateur courant ; le
        // harnais ne l'interprète pas, la liste pilotée ne contient donc que
        // l'acteur du scénario en cours.
        return state.participants.map((userId) => ({ id: `p-${userId}`, userId }));
      default:
        return [];
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chaine = (table?: unknown): any => {
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
      limit: () => Promise.resolve(lignes),
      returning: () => Promise.resolve(lignes),
      then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
        Promise.resolve(lignes).then(resoudre, rejeter),
    };
    return self;
  };

  const ecrire = (operation: string) => (table: unknown) => {
    state.ecritures.push({ operation, table: nomTable(table) });
    return chaine(table);
  };

  return {
    db: {
      select: () => chaine(),
      update: ecrire("update"),
      delete: ecrire("delete"),
      insert: ecrire("insert"),
      execute: () => Promise.resolve({ rows: [] }),
    },
  };
});

// next-auth n'est pas chargeable sous vitest : seul module remplacé sans
// `importOriginal`, pour son unique export utile.
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

vi.mock("@/lib/meet/egress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meet/egress")>()),
  startRecording: vi.fn(async () => "egress-1"),
  stopRecording: vi.fn(async () => undefined),
}));

vi.mock("@/lib/meet/livekit-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meet/livekit-config")>()),
  getLiveKitConfig: vi.fn(async () => ({
    livekitApiKey: "key",
    livekitApiSecret: "secret",
    livekitEgressPath: "/recordings",
  })),
}));

vi.mock("@/lib/meet/livekit-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meet/livekit-token")>()),
  generateLiveKitToken: vi.fn(async () => "jeton-livekit"),
}));

import { startRecording } from "@/lib/meet/egress";
import { generateLiveKitToken } from "@/lib/meet/livekit-token";

const mockStartRecording = vi.mocked(startRecording);
const mockToken = vi.mocked(generateLiveKitToken);

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const get = (url = "http://localhost/x") =>
  new NextRequest(url) as never;
const post = (body?: unknown) =>
  new NextRequest("http://localhost/x", {
    method: "POST",
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  }) as never;
const patch = (body: unknown) =>
  new NextRequest("http://localhost/x", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  }) as never;

/**
 * Les onze gestionnaires du module, avec l'appel minimal qui atteint leur
 * contrôle d'accès. Le corps fourni est toujours valide : un refus dû à une
 * validation de schéma ne prouverait rien.
 */
const GESTIONNAIRES: {
  nom: string;
  appeler: () => Promise<Response>;
}[] = [
  {
    nom: "GET /api/meet/rooms/[id]",
    appeler: async () =>
      (await import("@/app/api/meet/rooms/[id]/route")).GET(get(), ctx("meeting-b")),
  },
  {
    nom: "PATCH /api/meet/rooms/[id]",
    appeler: async () =>
      (await import("@/app/api/meet/rooms/[id]/route")).PATCH(
        patch({ title: "Titre volé" }),
        ctx("meeting-b")
      ),
  },
  {
    nom: "DELETE /api/meet/rooms/[id]",
    appeler: async () => {
      state.meeting.status = "scheduled"; // seul état supprimable
      return (await import("@/app/api/meet/rooms/[id]/route")).DELETE(
        get(),
        ctx("meeting-b")
      );
    },
  },
  {
    nom: "POST /api/meet/rooms/[id]/activate",
    appeler: async () => {
      state.meeting.status = "scheduled";
      return (await import("@/app/api/meet/rooms/[id]/activate/route")).POST(
        post(),
        ctx("meeting-b")
      );
    },
  },
  {
    nom: "POST /api/meet/rooms/[id]/end",
    appeler: async () =>
      (await import("@/app/api/meet/rooms/[id]/end/route")).POST(post(), ctx("meeting-b")),
  },
  {
    nom: "GET /api/meet/rooms/[id]/notes",
    appeler: async () =>
      (await import("@/app/api/meet/rooms/[id]/notes/route")).GET(get(), ctx("meeting-b")),
  },
  {
    nom: "PATCH /api/meet/rooms/[id]/speaker-mapping",
    appeler: async () => {
      state.meeting.status = "mapping";
      return (await import("@/app/api/meet/rooms/[id]/speaker-mapping/route")).PATCH(
        patch({ mapping: { SPEAKER_00: "Alice" } }),
        ctx("meeting-b")
      );
    },
  },
  {
    nom: "POST /api/meet/rooms/[id]/start-recording",
    appeler: async () =>
      (await import("@/app/api/meet/rooms/[id]/start-recording/route")).POST(
        post(),
        ctx("meeting-b")
      ),
  },
  {
    nom: "GET /api/meet/rooms/[id]/status",
    appeler: async () =>
      (await import("@/app/api/meet/rooms/[id]/status/route")).GET(get(), ctx("meeting-b")),
  },
  {
    nom: "GET /api/meet/rooms/[id]/transcript",
    appeler: async () =>
      (await import("@/app/api/meet/rooms/[id]/transcript/route")).GET(
        get("http://localhost/x?meta=1"),
        ctx("meeting-b")
      ),
  },
  {
    nom: "POST /api/meet/token",
    appeler: async () =>
      (await import("@/app/api/meet/token/route")).POST(
        post({ roomName: state.meeting.roomName })
      ),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  state.meeting = {
    id: "meeting-b",
    roomName: "2026-01-01_reunion-b_abcdef",
    createdBy: "organisateur-b",
    spaceId: "space-prive-b",
    status: "active",
    egressId: null,
    title: "Réunion du service B",
    notesDocumentId: null,
    transcriptPath: null,
    speakerMapping: null,
    calendarEventId: null,
    meetingType: "video",
  };
  state.spaceAdmins = [];
  state.participants = [];
  state.requestOrgId = "org-b";
  state.sessionUser = null;
  state.ecritures = [];
});

describe("frontière d'espace : un membre de l'organisation étranger à la réunion", () => {
  for (const gestionnaire of GESTIONNAIRES) {
    it(`${gestionnaire.nom} refuse et n'écrit rien`, async () => {
      // Même organisation que la réunion, aucun droit sur l'espace porteur,
      // ni organisateur, ni participant, ni administrateur.
      state.sessionUser = {
        id: "curieux-b",
        globalRole: "editor",
        name: "Curieux B",
        email: "curieux@org-b.test",
      };

      const res = await gestionnaire.appeler();

      expect(res.status).toBe(403);
      // Le refus est lui-même journalisé : seule l'écriture du journal d'activité est permise.
      expect(state.ecritures.filter((e) => e.table !== "activity_log")).toEqual([]);
      expect(mockStartRecording).not.toHaveBeenCalled();
      expect(mockToken).not.toHaveBeenCalled();
    });
  }
});

describe("témoins : les mêmes gestionnaires laissent passer qui de droit", () => {
  it("l'organisateur obtient sa réunion, son statut et son jeton", async () => {
    state.sessionUser = {
      id: "organisateur-b",
      globalRole: "editor",
      name: "Organisateur B",
      email: "orga@org-b.test",
    };

    const { GET } = await import("@/app/api/meet/rooms/[id]/route");
    expect((await GET(get(), ctx("meeting-b"))).status).toBe(200);

    const { GET: STATUS } = await import("@/app/api/meet/rooms/[id]/status/route");
    expect((await STATUS(get(), ctx("meeting-b"))).status).toBe(200);

    const { POST: TOKEN } = await import("@/app/api/meet/token/route");
    expect((await TOKEN(post({ roomName: state.meeting.roomName }))).status).toBe(200);
    expect(mockToken).toHaveBeenCalledTimes(1);
  });

  it("un administrateur de l'espace lit la réunion", async () => {
    state.sessionUser = { id: "admin-espace-b", globalRole: "editor" };
    state.spaceAdmins = ["admin-espace-b"];

    const { GET } = await import("@/app/api/meet/rooms/[id]/route");
    expect((await GET(get(), ctx("meeting-b"))).status).toBe(200);
  });

  it("un participant enregistré lance l'enregistrement, choix assumé", async () => {
    // Le bouton d'enregistrement est rendu à tout participant : `canAccessMeeting`
    // y est délibérément préféré à « organisateur seul ». Ce témoin fige ce choix.
    state.sessionUser = { id: "participant-b", globalRole: "editor" };
    state.participants = ["participant-b"];

    const { POST } = await import(
      "@/app/api/meet/rooms/[id]/start-recording/route"
    );
    const res = await POST(post(), ctx("meeting-b"));

    expect(res.status).toBe(200);
    expect(mockStartRecording).toHaveBeenCalledWith(state.meeting.roomName);
  });
});
