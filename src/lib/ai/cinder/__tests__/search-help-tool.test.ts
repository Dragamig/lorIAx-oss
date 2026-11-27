import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ searchKb: vi.fn() }));
vi.mock("@/lib/kb/kb", () => ({ searchKb: h.searchKb }));
vi.mock("@/lib/ai/sanitize-content", () => ({
  sanitizeRagContent: (s: string) => `[${s}]`,
}));

import { createSearchHelpTool } from "../search-help-tool";

type Exec = (i: { query: string }, o: unknown) => Promise<unknown>;

beforeEach(() => {
  h.searchKb.mockReset();
});

describe("createSearchHelpTool", () => {
  it("appelle searchKb(query, 5, userId) et assainit le texte", async () => {
    h.searchKb.mockResolvedValue(
      Array.from({ length: 7 }, (_, i) => ({ source: `s${i}`, title: `t${i}`, chunkText: `c${i}` })),
    );
    const t = createSearchHelpTool("u1");
    const out = (await (t.execute as unknown as Exec)({ query: "kanban" }, {})) as {
      results: { title: string | null; source: string; text: string }[];
    };
    expect(h.searchKb).toHaveBeenCalledWith("kanban", 5, "u1");
    expect(out.results).toHaveLength(5);
    expect(out.results[0]).toEqual({ title: "t0", source: "s0", text: "[c0]" });
  });
  it("erreur : résultats vides et message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    h.searchKb.mockImplementation(async () => {
      throw new Error("x");
    });
    const t = createSearchHelpTool("u1");
    const out = await (t.execute as unknown as Exec)({ query: "kanban" }, {});
    expect(out).toEqual({
      results: [],
      error: "Recherche indisponible",
    });
  });
  it("schéma : refuse 2 et 301 caractères", () => {
    const schema = createSearchHelpTool("u1").inputSchema as unknown as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ query: "ab" }).success).toBe(false);
    expect(schema.safeParse({ query: "a".repeat(301) }).success).toBe(false);
    expect(schema.safeParse({ query: "abc" }).success).toBe(true);
  });
});
