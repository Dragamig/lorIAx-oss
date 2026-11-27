import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ loadConnection: vi.fn(), findRowById: vi.fn() }));
vi.mock("@/lib/databases/row-writes", () => ({
  findRowById: (...a: unknown[]) => h.findRowById(...a),
  createDatabaseRow: vi.fn(),
  withMatchLock: vi.fn(async (_d: string, _c: string, _k: string, cb: (tx: unknown) => Promise<unknown>) =>
    cb({ select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }) }),
  ),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/crm/connection", () => ({ loadConnection: (...a: unknown[]) => h.loadConnection(...a) }));
vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn() }));

import {
  CrmDisconnectedError,
  CrmTraceForbiddenError,
  mailExcerpt,
  interactionLabels,
  ensureDossierForMail,
  writeMailInteraction,
} from "../crm-trace";

describe("crm-trace pure helpers", () => {
  it("mailExcerpt collapses blank runs and caps with an ellipsis", () => {
    expect(mailExcerpt("  Bonjour\n\n\n\nMerci  ")).toBe("Bonjour\n\nMerci");
    const long = "a".repeat(800);
    const out = mailExcerpt(long);
    expect(out.length).toBe(501);
    expect(out.endsWith("…")).toBe(true);
  });

  it("interactionLabels maps the direction to type and sens labels", () => {
    expect(interactionLabels("out")).toEqual({ type: "Mail envoyé", sens: "Sortant" });
    expect(interactionLabels("in")).toEqual({ type: "Mail reçu", sens: "Entrant" });
  });
});

describe("crm-trace without a connection", () => {
  beforeEach(() => h.loadConnection.mockReset());

  it("ensureDossierForMail throws CrmDisconnectedError when the CRM is not connected", async () => {
    h.loadConnection.mockResolvedValue(null);
    await expect(
      ensureDossierForMail({ orgId: "o", userId: "u" }, { contactRowId: "c" }),
    ).rejects.toBeInstanceOf(CrmDisconnectedError);
  });

  it("writeMailInteraction throws CrmDisconnectedError when the CRM is disabled", async () => {
    h.loadConnection.mockResolvedValue({ enabled: false, roles: {} });
    await expect(
      writeMailInteraction({ id: "m", organizationId: "o", userId: "u", direction: "out" } as never),
    ).rejects.toBeInstanceOf(CrmDisconnectedError);
  });
});

describe("crm-trace requires the editor right of the sender (no system escalation)", () => {
  const role = (databaseId: string, keys: string[]) => ({
    connected: true,
    databaseId,
    columnIds: Object.fromEntries(keys.map((k) => [k, `${k}-col`])),
    fields: Object.fromEntries(keys.map((k) => [k, { state: "ok" }])),
  });
  const viewerConn = {
    enabled: true,
    roles: {
      contacts: role("c-db", ["nom", "email"]),
      dossiers: role("d-db", ["titre", "contact", "statut"]),
      interactions: role("i-db", ["date", "type", "dossier"]),
    },
  };

  beforeEach(() => {
    h.loadConnection.mockReset();
    h.findRowById.mockReset();
    h.findRowById.mockImplementation(async (db: string, id: string) =>
      db === "c-db" ? { id: "c", cells: {} } : { id, cells: { "contact-col": ["c"] } },
    );
    // Lecture permise (viewer), aucun droit d'édition : le raccordement « editor » ressort vide.
    h.loadConnection.mockImplementation(async (_o: string, _u: string, need: string) =>
      need === "viewer" ? viewerConn : { enabled: true, roles: { contacts: { connected: false }, dossiers: { connected: false }, interactions: { connected: false } } },
    );
  });

  it("ensureDossierForMail refuses to write when the sender is only a viewer", async () => {
    await expect(
      ensureDossierForMail({ orgId: "o", userId: "u" }, { contactRowId: "c" }),
    ).rejects.toBeInstanceOf(CrmTraceForbiddenError);
  });

  it("ensureDossierForMail returns an existing dossier to a viewer without any write", async () => {
    await expect(
      ensureDossierForMail({ orgId: "o", userId: "u" }, { contactRowId: "c", dossierRowId: "d" }),
    ).resolves.toEqual({ dossierRowId: "d", created: false });
  });

  it("writeMailInteraction refuses to write when the sender is only a viewer", async () => {
    await expect(
      writeMailInteraction({ id: "m", organizationId: "o", userId: "u", direction: "out", dossierRowId: "d", contactRowId: "c" } as never),
    ).rejects.toBeInstanceOf(CrmTraceForbiddenError);
  });
});
