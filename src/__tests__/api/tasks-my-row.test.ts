/**
 * GET /api/tasks/my : tâches de ligne (kind database_row), accès restreint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ queue: [] as unknown[][] }));
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-a", name: "Alice", email: "a@a.com", globalRole: "editor" }),
}));
vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn().mockResolvedValue("org-a"),
}));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn() }));
vi.mock("@/lib/db", () => {
  const makeChainableMock = () => {
    const next = () => Promise.resolve(h.queue.shift() ?? []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self: any = {
      then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
        next().then(resolve, reject),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
    };
    return self;
  };
  return { db: makeChainableMock() };
});

import { GET } from "@/app/api/tasks/my/route";
import { getSpacePermission } from "@/lib/auth/check-access";

const mockPerm = vi.mocked(getSpacePermission);

const base = {
  kind: "document_item",
  title: "T",
  status: "open",
  dueAt: null,
  documentId: null,
  calendarEventId: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
  documentTitle: null,
  spaceSlug: null,
  eventTitle: null,
  databaseId: null,
  rowId: null,
  databaseName: null,
  rowSpaceId: null,
  rowOrganizationId: null,
  rowSpaceSlug: null,
};
const rowTask = (id: string, over: Record<string, unknown> = {}) => ({
  ...base,
  id,
  kind: "database_row",
  databaseId: "db-1",
  rowId: "row-1",
  databaseName: "Clients",
  rowSpaceId: "space-1",
  rowOrganizationId: "org-a",
  rowSpaceSlug: "crm",
  ...over,
});

beforeEach(() => {
  h.queue = [];
  mockPerm.mockReset();
});

describe("GET /api/tasks/my, tâches de ligne", () => {
  it("une tâche de ligne avec accès renvoie rowLink et databaseName", async () => {
    h.queue = [[rowTask("t1")]];
    mockPerm.mockResolvedValue("viewer");
    const body = await (await GET()).json();
    const t = body.tasks[0];
    expect(t.restricted).toBe(false);
    expect(t.databaseName).toBe("Clients");
    expect(t.rowLink).toBe("/bases/db-1?row=row-1");
    expect(t.spaceSlug).toBe("crm");
    expect(t.databaseId).toBe("db-1");
    expect(t.rowId).toBe("row-1");
  });

  it("accès retiré à l'espace : la tâche reste, restricted vrai, databaseName et rowLink nuls", async () => {
    h.queue = [[rowTask("t1")]];
    mockPerm.mockResolvedValue(null);
    const body = await (await GET()).json();
    expect(body.tasks).toHaveLength(1);
    const t = body.tasks[0];
    expect(t.restricted).toBe(true);
    expect(t.databaseName).toBeNull();
    expect(t.rowLink).toBeNull();
    expect(t.databaseId).toBeNull();
    expect(t.rowId).toBeNull();
  });

  it("base d'une autre organisation : pas de nom résolu, restricted vrai", async () => {
    h.queue = [[rowTask("t1", { rowOrganizationId: "org-b" })]];
    mockPerm.mockResolvedValue("viewer");
    const t = (await (await GET()).json()).tasks[0];
    expect(t.restricted).toBe(true);
    expect(t.databaseName).toBeNull();
    expect(t.rowLink).toBeNull();
    expect(t.databaseId).toBeNull();
  });

  it("un seul appel getSpacePermission pour 3 tâches du même espace", async () => {
    h.queue = [[rowTask("t1"), rowTask("t2"), rowTask("t3")]];
    mockPerm.mockResolvedValue("editor");
    await GET();
    expect(mockPerm).toHaveBeenCalledTimes(1);
    expect(mockPerm).toHaveBeenCalledWith("user-a", "space-1");
  });

  it("tâches de document et de Gantt : champs ajoutés nuls, réponse inchangée par ailleurs", async () => {
    h.queue = [[
      { ...base, id: "d1", documentId: "doc-1", documentTitle: "Doc", spaceSlug: "s" },
      { ...base, id: "g1", kind: "gantt_event", calendarEventId: "ev-1", eventTitle: "Ev" },
    ]];
    const body = await (await GET()).json();
    expect(mockPerm).not.toHaveBeenCalled();
    const [d, g] = body.tasks;
    for (const t of [d, g]) {
      expect(t.databaseId).toBeNull();
      expect(t.rowId).toBeNull();
      expect(t.databaseName).toBeNull();
      expect(t.rowLink).toBeNull();
      expect(t.restricted).toBe(false);
    }
    expect(d.documentUrl).toBe("/s/s/doc-1");
    expect(d.documentTitle).toBe("Doc");
    expect(g.ganttUrl).toBe("/calendar");
    expect(g.eventTitle).toBe("Ev");
  });
});
