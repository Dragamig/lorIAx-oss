import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ settings: vi.fn(), today: vi.fn(), enqueue: vi.fn() }));
vi.mock("./settings", () => ({ getMediaAiSettings: h.settings }));
vi.mock("./runner", () => ({ indexedToday: h.today }));
vi.mock("./enqueue", () => ({ enqueueMediaIndex: h.enqueue }));

import { requestReindex } from "./reindex";

const row = { id: "m1", organizationId: "o1", mimeType: "application/pdf", filename: "a.pdf" };

beforeEach(() => {
  vi.clearAllMocks();
  h.settings.mockResolvedValue({ indexEnabled: true, transcribeEnabled: false });
  h.today.mockResolvedValue(0);
});

describe("requestReindex", () => {
  it("met en file en mode manuel", async () => {
    expect(await requestReindex(row)).toEqual({ ok: true, status: "pending" });
    expect(h.enqueue).toHaveBeenCalledWith("m1", "manual");
  });
  it("refuse si l'indexation est désactivée", async () => {
    h.settings.mockResolvedValue({ indexEnabled: false, transcribeEnabled: false });
    expect(await requestReindex(row)).toMatchObject({ ok: false, status: 409, code: "index_disabled" });
    expect(h.enqueue).not.toHaveBeenCalled();
  });
  it("refuse si le plafond du jour est atteint", async () => {
    h.today.mockResolvedValue(300);
    expect(await requestReindex(row)).toMatchObject({ ok: false, status: 429, code: "daily_cap" });
  });
  it("refuse un type sans extracteur", async () => {
    expect(await requestReindex({ ...row, mimeType: "application/zip", filename: "a.zip" })).toMatchObject({ ok: false, status: 415 });
  });
});
