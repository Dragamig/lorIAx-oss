/**
 * Cloisonnement de POST /api/meet/rooms : calendrier lié et invités.
 *
 * Le lot 6 avait durci le seul `documentId`. Deux entrées du corps de la
 * requête restaient reprises telles quelles jusqu'à l'écriture en base :
 * - `calendarId` : `createMeeting` insère un `calendar_events` dans ce
 *   calendrier. Sans contrôle, un compte légitime agissant dans son propre
 *   espace posait un événement dans le calendrier privé d'un tiers.
 * - `attendeeUserIds` : autant de lignes `calendar_event_attendees`, sans
 *   contrôle d'appartenance. Des utilisateurs d'un autre tenant étaient donc
 *   convoqués, et la réunion apparaissait dans leur agenda.
 *
 * FIDÉLITÉ DU HARNAIS. `@/lib/meet/rooms` n'est PAS doublé : c'est la vraie
 * `createMeeting` qui s'exécute, sur un faux client Drizzle qui enregistre les
 * insertions PAR TABLE. L'absence d'effet est donc prouvée par l'absence
 * d'insertion réelle dans `calendar_events` / `calendar_event_attendees`, pas
 * par le non-appel d'une doublure. Les modules doublés le sont avec
 * `importOriginal()`, seuls les exports réellement pilotés étant étalés :
 * annuler le correctif de la route fait rougir une ASSERTION, jamais un import.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  requestOrgId: "org-a" as string | null,
  /** Calendriers sur lesquels l'utilisateur courant a le droit d'écriture. */
  calendriersEnEcriture: [] as string[],
  /** Membres de l'organisation de la requête. */
  membres: [] as string[],
  /** Insertions réellement soumises, par table. */
  insertions: [] as { table: string; rows: Record<string, unknown>[] }[],
}));

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

vi.mock("@/lib/db", () => {
  const nomTable = (table: unknown): string =>
    (table as Record<symbol, string> | null | undefined)?.[DRIZZLE_NAME] ?? "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chaineLecture = (): any => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      from: () => self,
      innerJoin: () => self,
      where: () => self,
      set: () => self,
      orderBy: () => self,
      limit: () => Promise.resolve([]),
      returning: () => Promise.resolve([]),
      then: (resoudre: (v: unknown[]) => void, rejeter?: (e: unknown) => void) =>
        Promise.resolve([]).then(resoudre, rejeter),
    };
    return self;
  };

  const chaineInsertion = (table: unknown) => {
    const nom = nomTable(table);
    return {
      values: (valeurs: unknown) => {
        const rows = (Array.isArray(valeurs) ? valeurs : [valeurs]) as Record<
          string,
          unknown
        >[];
        state.insertions.push({ table: nom, rows });
        const sortie = rows.map((r, i) => ({ ...r, id: `${nom}-${i}` }));
        return {
          returning: () => Promise.resolve(sortie),
          then: (
            resoudre: (v: unknown[]) => void,
            rejeter?: (e: unknown) => void
          ) => Promise.resolve(sortie).then(resoudre, rejeter),
        };
      },
    };
  };

  return {
    db: {
      select: () => chaineLecture(),
      update: () => chaineLecture(),
      delete: () => chaineLecture(),
      insert: (table: unknown) => chaineInsertion(table),
      execute: () => Promise.resolve({ rows: [] }),
    },
  };
});

// `@/lib/auth/get-user` tire next-auth, non chargeable sous vitest : c'est le
// seul module remplacé sans `importOriginal`. Il n'expose qu'un export utile.
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "user-a",
    name: "Utilisateur A",
    email: "a@org-a.test",
    globalRole: "editor",
  })),
}));

vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimitAsync: vi.fn(async () => ({ success: true, remaining: 99, resetAt: 0 })),
  getClientIpOrNull: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/org/get-request-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/get-request-org")>()),
  getRequestOrgId: vi.fn(async () => state.requestOrgId),
}));

vi.mock("@/lib/meet/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/meet/permissions")>()),
  checkVisioPermission: vi.fn(async () => true),
}));

vi.mock("@/lib/calendar/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calendar/permissions")>()),
  checkCalendarAccess: vi.fn(
    async (
      _userId: string,
      calendarId: string,
      action: "read" | "write" | "admin",
      orgId: string | null
    ) =>
      // Fail-closed comme la vraie brique : pas d'organisation, pas d'accès.
      orgId !== null &&
      action === "write" &&
      state.calendriersEnEcriture.includes(calendarId)
  ),
}));

vi.mock("@/lib/org/org-members", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/org-members")>()),
  getOrgMemberIds: vi.fn(async () => state.membres),
}));

vi.mock("@/lib/onboarding/progress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/onboarding/progress")>()),
  recordOnboardingEvent: vi.fn(async () => undefined),
}));

import { checkCalendarAccess } from "@/lib/calendar/permissions";

const mockCalendarAccess = vi.mocked(checkCalendarAccess);

const SPACE_ID = "22222222-2222-4222-8222-222222222222";
const CALENDRIER_A = "33333333-3333-4333-8333-333333333333";
const CALENDRIER_TIERS = "44444444-4444-4444-8444-444444444444";
const MEMBRE_A = "55555555-5555-4555-8555-555555555555";
const ETRANGER_B = "66666666-6666-4666-8666-666666666666";

const req = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/meet/rooms", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const corpsPlanifie = (extra: Record<string, unknown>) => ({
  title: "Réunion de A",
  spaceId: SPACE_ID,
  mode: "scheduled",
  scheduledAt: "2026-09-01T10:00:00.000Z",
  ...extra,
});

/** Lignes réellement insérées dans une table donnée. */
const inserees = (table: string) =>
  state.insertions.filter((i) => i.table === table).flatMap((i) => i.rows);

beforeEach(() => {
  vi.clearAllMocks();
  state.requestOrgId = "org-a";
  state.calendriersEnEcriture = [CALENDRIER_A];
  state.membres = ["user-a", MEMBRE_A];
  state.insertions = [];
});

describe("POST /api/meet/rooms : calendrier lié", () => {
  it("refuse et n'écrit AUCUN événement dans le calendrier d'un tiers", async () => {
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(req(corpsPlanifie({ calendarId: CALENDRIER_TIERS })));

    // L'absence d'effet est assertée EN PREMIER : c'est elle qui porte la
    // garantie, le statut n'en est que la façade. Aucune ligne d'événement, et
    // pas même la réunion : le refus intervient avant toute écriture.
    expect(inserees("calendar_events")).toEqual([]);
    expect(inserees("calendar_event_attendees")).toEqual([]);
    expect(inserees("meetings")).toEqual([]);
    expect(res.status).toBe(403);
  });

  it("exige le droit d'ÉCRITURE, dans l'organisation de la requête", async () => {
    const { POST } = await import("@/app/api/meet/rooms/route");
    await POST(req(corpsPlanifie({ calendarId: CALENDRIER_A })));

    expect(mockCalendarAccess).toHaveBeenCalledWith(
      "user-a",
      CALENDRIER_A,
      "write",
      "org-a"
    );
  });

  it("écrit bien l'événement quand le calendrier est le sien (témoin)", async () => {
    // Témoin : le chemin d'écriture existe et est atteignable. Le vide du
    // premier test vient donc du contrôle, pas d'un harnais inerte.
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(req(corpsPlanifie({ calendarId: CALENDRIER_A })));

    expect(res.status).toBe(201);
    const evenements = inserees("calendar_events");
    expect(evenements).toHaveLength(1);
    expect(evenements[0].calendarId).toBe(CALENDRIER_A);
  });
});

describe("POST /api/meet/rooms : invités", () => {
  it("refuse et n'insère AUCUN participant étranger à l'organisation", async () => {
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(
      req(
        corpsPlanifie({
          calendarId: CALENDRIER_A,
          attendeeUserIds: [MEMBRE_A, ETRANGER_B],
        })
      )
    );

    // Ni l'étranger, ni le membre légitime de la même requête, ni l'événement.
    expect(inserees("calendar_event_attendees")).toEqual([]);
    expect(inserees("calendar_events")).toEqual([]);
    expect(inserees("meetings")).toEqual([]);
    // Même réponse qu'un identifiant inexistant : pas d'oracle d'existence.
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Utilisateur introuvable");
  });

  it("refuse aussi quand l'étranger est seul dans la liste", async () => {
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(
      req(
        corpsPlanifie({
          calendarId: CALENDRIER_A,
          attendeeUserIds: [ETRANGER_B],
        })
      )
    );

    expect(inserees("calendar_event_attendees")).toEqual([]);
    expect(res.status).toBe(404);
  });

  it("convoque bien un membre de l'organisation (témoin)", async () => {
    const { POST } = await import("@/app/api/meet/rooms/route");
    const res = await POST(
      req(
        corpsPlanifie({
          calendarId: CALENDRIER_A,
          attendeeUserIds: [MEMBRE_A],
        })
      )
    );

    expect(res.status).toBe(201);
    const invites = inserees("calendar_event_attendees");
    const userIds = invites.map((i) => i.userId);
    // L'organisateur, plus le membre invité.
    expect(userIds).toContain("user-a");
    expect(userIds).toContain(MEMBRE_A);
    expect(userIds).not.toContain(ETRANGER_B);
  });
});
