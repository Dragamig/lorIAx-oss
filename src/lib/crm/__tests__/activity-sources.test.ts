import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CrmContext, CrmRow } from "../context";

const { readRoleRows, listRowTasks } = vi.hoisted(() => ({ readRoleRows: vi.fn(), listRowTasks: vi.fn() }));
vi.mock("../context", async (orig) => ({ ...(await orig<typeof import("../context")>()), readRoleRows }));
vi.mock("@/lib/databases/row-tasks", () => ({ listRowTasks }));

import { loadActivityInteractions, loadActivityTasks, ACTIVITY_SOURCE_LIMIT } from "../activity";

const COLS: Record<string, string> = {
  "interactions.date": "c-date",
  "interactions.dossier": "c-dossier",
  "interactions.contact": "c-contact",
  "interactions.intitule": "c-title",
  "dossiers.contact": "c-dcontact",
};
const ctx = {
  orgId: "o",
  userId: "u",
  columns: { contacts: [], dossiers: [], interactions: [] },
  fieldColumn: (role: string, key: string) => COLS[`${role}.${key}`] ?? null,
  fieldState: () => "ok",
  databaseId: (r: string) => `db-${r}`,
  spaceId: () => "s",
  canEdit: () => true,
} as unknown as CrmContext;

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (id: string, cells: Record<string, unknown>): CrmRow => ({
  id,
  databaseId: "x",
  cells,
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const inter = (id: string, date: string, extra: Record<string, unknown> = {}) =>
  row(id, { "c-date": date, "c-title": `t-${id}`, ...extra });

// Simule la base : renvoie les lignes selon le rôle demandé.
function setup(data: { dossiers?: CrmRow[]; contacts?: CrmRow[]; interactions?: CrmRow[] }) {
  readRoleRows.mockImplementation(async (_c: unknown, role: "dossiers" | "contacts" | "interactions") => data[role] ?? []);
}

beforeEach(() => {
  readRoleRows.mockReset();
  listRowTasks.mockReset();
});

describe("loadActivityInteractions", () => {
  it("dossier inconnu de la base : null", async () => {
    setup({ dossiers: [] });
    expect(await loadActivityInteractions(ctx, { kind: "deal", rowId: UUID(1) })).toBeNull();
  });

  it("identifiant non UUID : null sans requête", async () => {
    expect(await loadActivityInteractions(ctx, { kind: "deal", rowId: "x" })).toBeNull();
    expect(readRoleRows).not.toHaveBeenCalled();
  });

  it("dossier : exclut les interactions d'un autre dossier, plus récentes d'abord", async () => {
    setup({
      dossiers: [row(UUID(1), {})],
      interactions: [
        inter("a", "2026-03-01", { "c-dossier": [UUID(1)] }),
        inter("b", "2026-04-01", { "c-dossier": [UUID(1)] }),
        inter("other", "2026-05-01", { "c-dossier": [UUID(2)] }),
      ],
    });
    const r = await loadActivityInteractions(ctx, { kind: "deal", rowId: UUID(1) });
    expect(r!.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("contact sans dossier : interactions directes seules", async () => {
    setup({
      contacts: [row(UUID(9), {})],
      dossiers: [row(UUID(1), { "c-dcontact": [UUID(8)] })],
      interactions: [
        inter("direct", "2026-03-01", { "c-contact": [UUID(9)] }),
        inter("foreign", "2026-04-01", { "c-dossier": [UUID(1)] }),
      ],
    });
    const r = await loadActivityInteractions(ctx, { kind: "contact", rowId: UUID(9) });
    expect(r!.map((i) => i.id)).toEqual(["direct"]);
  });

  it("contact : directes plus celles de ses dossiers, sans doublon", async () => {
    setup({
      contacts: [row(UUID(9), {})],
      dossiers: [row(UUID(1), { "c-dcontact": [UUID(9)] }), row(UUID(2), { "c-dcontact": [UUID(7)] })],
      interactions: [
        inter("direct", "2026-03-01", { "c-contact": [UUID(9)] }),
        inter("viaDeal", "2026-04-01", { "c-dossier": [UUID(1)] }),
        inter("both", "2026-02-01", { "c-contact": [UUID(9)], "c-dossier": [UUID(1)] }),
        inter("other", "2026-05-01", { "c-dossier": [UUID(2)] }),
      ],
    });
    const r = await loadActivityInteractions(ctx, { kind: "contact", rowId: UUID(9) });
    expect(r!.map((i) => i.id)).toEqual(["viaDeal", "direct", "both"]);
  });

  it("contact d'une autre base : null", async () => {
    setup({ contacts: [], dossiers: [], interactions: [] });
    expect(await loadActivityInteractions(ctx, { kind: "contact", rowId: UUID(9) })).toBeNull();
  });

  it("plafond respecté", async () => {
    const many = Array.from({ length: ACTIVITY_SOURCE_LIMIT + 50 }, (_, i) =>
      inter(`i${i}`, `2026-01-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`, { "c-dossier": [UUID(1)] }),
    );
    setup({ dossiers: [row(UUID(1), {})], interactions: many });
    const r = await loadActivityInteractions(ctx, { kind: "deal", rowId: UUID(1) });
    expect(r).toHaveLength(ACTIVITY_SOURCE_LIMIT);
  });
});

describe("loadActivityTasks", () => {
  it("projette id, titre, échéance, statut et plafonne", async () => {
    listRowTasks.mockResolvedValue(
      Array.from({ length: ACTIVITY_SOURCE_LIMIT + 5 }, (_, i) => ({
        id: `t${i}`,
        title: `T${i}`,
        status: "open",
        dueAt: "2026-06-01T00:00:00.000Z",
        assignee: { id: "a1", name: "A" },
        createdBy: "u",
        createdAt: "2026-01-01T00:00:00.000Z",
      })),
    );
    const r = await loadActivityTasks({} as never, { databaseId: "d", rowId: "r" });
    expect(r).toHaveLength(ACTIVITY_SOURCE_LIMIT);
    expect(r[0]).toEqual({ id: "t0", title: "T0", dueAt: "2026-06-01T00:00:00.000Z", status: "open", assigneeId: "a1", createdBy: "u" });
    expect(listRowTasks).toHaveBeenCalledWith({}, { databaseId: "d", rowId: "r" });
  });
});
