import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ settings: vi.fn(), rows: vi.fn() }));
vi.mock("./settings", () => ({ getMediaAiSettings: h.settings }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => h.rows() }) }) }) },
}));

import { getMediaTextState, TEXT_PAGE_MAX } from "./text-state";

const m = { id: "m1", organizationId: "o1", mimeType: "application/pdf", filename: "a.pdf" };
const done = (text: string, org = "o1") => ({
  organizationId: org, status: "done", reason: null, source: "pdf", text, truncated: false,
  indexedAt: new Date("2026-01-01T00:00:00Z"), version: 2,
});

beforeEach(() => {
  h.settings.mockResolvedValue({ indexEnabled: true });
  h.rows.mockResolvedValue([done("abcdef")]);
});

describe("getMediaTextState", () => {
  it("unsupported sans extracteur, disabled si interrupteur faux (jamais de texte)", async () => {
    expect((await getMediaTextState({ ...m, mimeType: "application/zip", filename: "a.zip" })).status).toBe("unsupported");
    h.settings.mockResolvedValue({ indexEnabled: false });
    const s = await getMediaTextState(m);
    expect(s.status).toBe("disabled");
    expect(s.text).toBeNull();
  });
  it("texte absent tant que le statut n'est pas done", async () => {
    h.rows.mockResolvedValue([{ ...done("abc"), status: "pending" }]);
    expect((await getMediaTextState(m)).text).toBeNull();
  });
  it("pagination bornée", async () => {
    const s = await getMediaTextState(m, { offset: 2, limit: 3 });
    expect(s).toMatchObject({ text: "cde", offset: 2, nextOffset: 5, totalChars: 6 });
    h.rows.mockResolvedValue([done("x".repeat(TEXT_PAGE_MAX + 10))]);
    expect((await getMediaTextState(m, { limit: 10 ** 9 })).text).toHaveLength(TEXT_PAGE_MAX);
  });
  it("ligne d'une autre organisation : jamais de texte", async () => {
    h.rows.mockResolvedValue([done("secret", "o2")]);
    expect((await getMediaTextState(m)).text).toBeNull();
  });
});
