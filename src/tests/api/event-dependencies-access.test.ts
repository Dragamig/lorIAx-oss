/**
 * Contrôle d'accès — dépendances entre événements d'agenda
 *
 * POST /api/events/[id]/dependencies et DELETE /api/events/[id]/dependencies/[depId]
 * ne vérifiaient que l'authentification : n'importe quel compte pouvait créer ou
 * supprimer une dépendance entre des événements d'une autre organisation à
 * partir de leurs UUID. Les deux routes exigent désormais un droit d'écriture
 * sur le calendrier de l'événement source, et l'événement cible doit appartenir
 * au même calendrier.
 *
 * DELETE /api/calendars/[id]/gantt/dependencies vérifiait le calendrier mais pas
 * les deux événements de la paire supprimée : un droit d'écriture sur un
 * calendrier quelconque suffisait à casser la dépendance d'un autre.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

let results: unknown[][] = [];
let idx = 0;

const deleteWhere = vi.fn(() => Promise.resolve(undefined));
const returning = vi.fn(() => Promise.resolve([{ id: "dep-1" }]));

const makeChainableMock = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => {
      idx += 1;
      return self;
    }),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(() => Promise.resolve(results[idx - 1] ?? [])),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(results[idx - 1] ?? []).then(resolve, reject),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning,
    delete: vi.fn(() => ({ where: deleteWhere })),
  };
  return self;
};

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-a",
    name: "User A",
    email: "a@org-a.com",
    globalRole: "user",
  }),
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

vi.mock("@/lib/db", () => ({ db: makeChainableMock() }));

import { checkCalendarAccess } from "@/lib/calendar/permissions";

const mockCalendarAccess = vi.mocked(checkCalendarAccess);

const CAL_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
  results = [];
  idx = 0;
  returning.mockResolvedValue([{ id: "dep-1" }] as never);
});

// ─── POST /api/events/[id]/dependencies ──────────────────────────────────────

const postReq = (body: unknown) =>
  new NextRequest(`http://localhost/api/events/${SOURCE_ID}/dependencies`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const postCtx = { params: Promise.resolve({ id: SOURCE_ID }) };

describe("POST /api/events/[id]/dependencies", () => {
  it("répond 404 quand l'événement source n'existe pas", async () => {
    results = [[]];
    const { POST } = await import("@/app/api/events/[id]/dependencies/route");
    const res = await POST(postReq({ targetEventId: TARGET_ID }), postCtx);
    expect(res.status).toBe(404);
    expect(mockCalendarAccess).not.toHaveBeenCalled();
  });

  it("répond 403 sans droit d'écriture sur le calendrier de l'événement source", async () => {
    results = [[{ calendarId: CAL_ID }]];
    mockCalendarAccess.mockResolvedValue(false);
    const { POST } = await import("@/app/api/events/[id]/dependencies/route");
    const res = await POST(postReq({ targetEventId: TARGET_ID }), postCtx);
    expect(res.status).toBe(403);
    expect(returning).not.toHaveBeenCalled();
    expect(mockCalendarAccess).toHaveBeenCalledWith("user-a", CAL_ID, "write", "org-test");
  });

  it("répond 404 quand l'événement cible appartient à un autre calendrier", async () => {
    results = [[{ calendarId: CAL_ID }], [{ id: SOURCE_ID }]];
    mockCalendarAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/events/[id]/dependencies/route");
    const res = await POST(postReq({ targetEventId: TARGET_ID }), postCtx);
    expect(res.status).toBe(404);
    expect(returning).not.toHaveBeenCalled();
  });

  it("crée la dépendance quand les deux événements sont dans un calendrier autorisé", async () => {
    results = [
      [{ calendarId: CAL_ID }],
      [{ id: SOURCE_ID }, { id: TARGET_ID }],
      [],
    ];
    mockCalendarAccess.mockResolvedValue(true);
    const { POST } = await import("@/app/api/events/[id]/dependencies/route");
    const res = await POST(postReq({ targetEventId: TARGET_ID }), postCtx);
    expect(res.status).toBe(201);
    expect(returning).toHaveBeenCalled();
  });
});

// ─── DELETE /api/events/[id]/dependencies/[depId] ────────────────────────────

const delCtx = {
  params: Promise.resolve({ id: SOURCE_ID, depId: "dep-1" }),
};

const delReq = () =>
  new NextRequest(
    `http://localhost/api/events/${SOURCE_ID}/dependencies/dep-1`,
    { method: "DELETE" }
  );

describe("DELETE /api/events/[id]/dependencies/[depId]", () => {
  it("répond 404 quand la dépendance n'appartient pas à l'événement du chemin", async () => {
    results = [[]];
    const { DELETE } = await import(
      "@/app/api/events/[id]/dependencies/[depId]/route"
    );
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(404);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("répond 403 sans droit d'écriture sur le calendrier", async () => {
    results = [[{ sourceEventId: SOURCE_ID }], [{ calendarId: CAL_ID }]];
    mockCalendarAccess.mockResolvedValue(false);
    const { DELETE } = await import(
      "@/app/api/events/[id]/dependencies/[depId]/route"
    );
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(403);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("supprime la dépendance quand le droit d'écriture est accordé", async () => {
    results = [[{ sourceEventId: SOURCE_ID }], [{ calendarId: CAL_ID }]];
    mockCalendarAccess.mockResolvedValue(true);
    const { DELETE } = await import(
      "@/app/api/events/[id]/dependencies/[depId]/route"
    );
    const res = await DELETE(delReq(), delCtx);
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalled();
  });
});

// ─── DELETE /api/calendars/[id]/gantt/dependencies ───────────────────────────

const ganttReq = () =>
  new NextRequest(
    `http://localhost/api/calendars/${CAL_ID}/gantt/dependencies`,
    {
      method: "DELETE",
      body: JSON.stringify({
        sourceEventId: SOURCE_ID,
        targetEventId: TARGET_ID,
      }),
      headers: { "content-type": "application/json" },
    }
  );

const ganttCtx = { params: Promise.resolve({ id: CAL_ID }) };

describe("DELETE /api/calendars/[id]/gantt/dependencies", () => {
  it("répond 404 quand la paire ne vit pas dans ce calendrier", async () => {
    results = [[{ id: SOURCE_ID }]];
    mockCalendarAccess.mockResolvedValue(true);
    const { DELETE } = await import(
      "@/app/api/calendars/[id]/gantt/dependencies/route"
    );
    const res = await DELETE(ganttReq(), ganttCtx);
    expect(res.status).toBe(404);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("supprime la dépendance quand les deux événements sont dans le calendrier", async () => {
    results = [[{ id: SOURCE_ID }, { id: TARGET_ID }]];
    mockCalendarAccess.mockResolvedValue(true);
    const { DELETE } = await import(
      "@/app/api/calendars/[id]/gantt/dependencies/route"
    );
    const res = await DELETE(ganttReq(), ganttCtx);
    expect(res.status).toBe(200);
    expect(deleteWhere).toHaveBeenCalled();
  });
});
