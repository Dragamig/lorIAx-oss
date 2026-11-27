import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  claimDue: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ status: "sent" }] }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [], catch: () => {} }) }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({ crmConnections: {} }));
vi.mock("@/lib/logger", () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("../crm-trace", () => ({ CrmDisconnectedError: class extends Error {}, ensureDossierForMail: vi.fn(), writeMailInteraction: vi.fn() }));
vi.mock("../outbox", () => ({
  arm: vi.fn(),
  claimDue: (...a: unknown[]) => h.claimDue(...a),
  deliver: (...a: unknown[]) => h.deliver(...a),
  touchSending: vi.fn(async () => true),
}));

import { deliverDue } from "../tick";

beforeEach(() => {
  h.claimDue.mockReset();
  h.deliver.mockReset();
});

describe("deliverDue garde module", () => {
  it("un deliverDue encore en cours n'est pas relancé en parallèle", async () => {
    let release!: () => void;
    h.claimDue.mockResolvedValueOnce([{ id: "m1", organizationId: "o" }]).mockResolvedValue([]);
    h.deliver.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const first = deliverDue();
    await vi.waitFor(() => expect(h.deliver).toHaveBeenCalledTimes(1));
    expect(await deliverDue()).toBe(0);
    expect(h.claimDue).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toBe(1);
  });

  it("la garde est relâchée après la fin, même en cas d'erreur", async () => {
    h.claimDue.mockRejectedValueOnce(new Error("db down")).mockResolvedValue([]);
    await expect(deliverDue()).rejects.toThrow("db down");
    await deliverDue();
    expect(h.claimDue).toHaveBeenCalledTimes(2);
  });
});
