import { describe, it, expect } from "vitest";
import { setRowChangeContext, SKIP_ROW_HISTORY } from "../row-change-context";

describe("row-change-context", () => {
  it("sérialise le contexte en JSON en omettant les champs absents", async () => {
    let captured: unknown;
    const tx = {
      execute: async (q: unknown) => {
        captured = q;
      },
    };
    await setRowChangeContext(tx as never, { source: "ui", actorUserId: "u1", actorLabel: undefined });
    const text = JSON.stringify(captured);
    expect(text).toContain("loriax.row_ctx");
    expect(text).toContain(JSON.stringify({ source: "ui", actorUserId: "u1" }).replace(/"/g, '\\"'));
    expect(text).not.toContain("actorLabel");
  });

  it("SKIP_ROW_HISTORY vaut { source: system, skip: true }", () => {
    expect(SKIP_ROW_HISTORY).toEqual({ source: "system", skip: true });
  });
});
