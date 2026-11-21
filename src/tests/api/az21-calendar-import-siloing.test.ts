/**
 * AZ-21 : POST /api/calendars/import
 *
 * La déduplication ICS cherchait l'UID en portée globale, sans borne sur le
 * calendrier autorisé : un ICS forgé reprenant l'UID d'un événement d'un autre
 * calendrier écrasait cet événement, alors même que l'importateur n'y a aucun
 * accès.
 *
 * Le test simule une base où l'UID existe UNIQUEMENT dans un autre calendrier
 * et prouve qu'aucun `update` n'a lieu : l'import passe par un `insert` dans le
 * calendrier cible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Base simulée : l'UID importé existe déjà, mais dans un AUTRE calendrier. Une
 * recherche non bornée le trouve (comportement d'avant le correctif), une
 * recherche bornée au calendrier cible ne trouve que `doublonMemeCalendrier`.
 */
const DOUBLON_AUTRE_CALENDRIER = { id: "evt-autre-calendrier", sequence: 1 };
let doublonMemeCalendrier: { id: string; sequence: number } | null = null;
const selectWhere = vi.fn();
const updateSet = vi.fn();
const insertValues = vi.fn((_valeurs: unknown) => Promise.resolve(undefined));

const makeDbMock = () => ({
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: (clause: unknown) => {
        selectWhere(clause);
        const borne = colonnes(clause).includes(calendarEvents.calendarId.name);
        const lignes = borne
          ? doublonMemeCalendrier
            ? [doublonMemeCalendrier]
            : []
          : [DOUBLON_AUTRE_CALENDRIER];
        return { limit: vi.fn(() => Promise.resolve(lignes)) };
      },
    })),
  })),
  update: vi.fn(() => ({
    set: vi.fn((valeurs: unknown) => {
      updateSet(valeurs);
      return { where: vi.fn(() => Promise.resolve(undefined)) };
    }),
  })),
  insert: vi.fn(() => ({ values: insertValues })),
});

vi.mock("@/lib/db", () => ({ db: makeDbMock() }));

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(),
}));

// Ces routes résolvent désormais l'organisation de la requête avant tout
// contrôle de calendrier (`checkCalendarAccess` la reçoit en paramètre
// obligatoire). Le contexte de requête Next n'existe pas ici : on rend une
// organisation fixe, la décision testée restant celle du mock de permission.
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-test"),
}));

vi.mock("@/lib/calendar/permissions", () => ({
  checkCalendarAccess: vi.fn(),
}));

vi.mock("@/lib/calendar/ical", () => ({
  parseICalendar: vi.fn(),
}));

import { getSessionUser } from "@/lib/auth/get-user";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { parseICalendar } from "@/lib/calendar/ical";
import { calendarEvents } from "@/lib/db/schema";

const mockUser = vi.mocked(getSessionUser);
const mockAcces = vi.mocked(checkCalendarAccess);
const mockParse = vi.mocked(parseICalendar);

const CALENDRIER_CIBLE = "11111111-1111-4111-8111-111111111111";

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

const req = () =>
  new Request("http://localhost/api/calendars/import", {
    method: "POST",
    body: JSON.stringify({
      calendarId: CALENDRIER_CIBLE,
      icsContent: "BEGIN:VCALENDAR\nEND:VCALENDAR",
    }),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  doublonMemeCalendrier = null;
  mockUser.mockResolvedValue({
    id: "user-a",
    name: "Alice",
    email: "alice@org-a.com",
    globalRole: "editor",
  } as never);
  mockAcces.mockResolvedValue(true as never);
  mockParse.mockReturnValue([
    {
      uid: "uid-partage@exemple.fr",
      title: "Événement forgé",
      startAt: new Date("2026-01-01T10:00:00Z"),
      endAt: new Date("2026-01-01T11:00:00Z"),
      allDay: false,
      sequence: 9,
    },
  ] as never);
});

describe("POST /api/calendars/import : déduplication bornée au calendrier", () => {
  it("n'écrase pas l'événement d'un autre calendrier : insertion, pas mise à jour", async () => {
    // L'UID existe dans un autre calendrier uniquement : la recherche bornée
    // au calendrier cible ne doit rien trouver.
    const { POST } = await import("@/app/api/calendars/import/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 1, updated: 0 });
    expect(updateSet).not.toHaveBeenCalled();
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      calendarId: CALENDRIER_CIBLE,
      uid: "uid-partage@exemple.fr",
    });
  });

  it("borne explicitement la recherche de doublon au calendrier cible", async () => {
    const { POST } = await import("@/app/api/calendars/import/route");
    await POST(req());
    expect(selectWhere).toHaveBeenCalledTimes(1);
    const clause = selectWhere.mock.calls[0][0];
    expect(colonnes(clause)).toContain(calendarEvents.uid.name);
    expect(colonnes(clause)).toContain(calendarEvents.calendarId.name);
  });

  it("met bien à jour un doublon du MÊME calendrier", async () => {
    doublonMemeCalendrier = { id: "evt-1", sequence: 1 };
    const { POST } = await import("@/app/api/calendars/import/route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, updated: 1 });
    expect(updateSet).toHaveBeenCalledTimes(1);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("répond 403 sans rien écrire si l'accès en écriture est refusé", async () => {
    mockAcces.mockResolvedValueOnce(false as never);
    const { POST } = await import("@/app/api/calendars/import/route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });
});
