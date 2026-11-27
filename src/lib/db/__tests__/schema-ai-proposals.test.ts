import { describe, it, expect } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

describe("schema-ai-proposals", () => {
  it("les tables sont atteignables depuis schema.ts (réexport)", () => {
    expect(schema.aiProposals).toBeDefined();
    expect(schema.aiToolCalls).toBeDefined();
  });

  it("ai_proposals : index (user_id, status) et expires_at, statut pending par défaut", () => {
    const cfg = getTableConfig(schema.aiProposals);
    expect(cfg.name).toBe("ai_proposals");
    const indexCols = cfg.indexes.map((i) => i.config.columns.map((c) => (c as { name: string }).name));
    expect(indexCols).toContainEqual(["user_id", "status"]);
    expect(indexCols).toContainEqual(["expires_at"]);
    const status = cfg.columns.find((c) => c.name === "status");
    expect(status?.default).toBe("pending");
  });

  it("ai_tool_calls : nom de table et proposalId nullable", () => {
    const cfg = getTableConfig(schema.aiToolCalls);
    expect(cfg.name).toBe("ai_tool_calls");
    expect(cfg.columns.find((c) => c.name === "proposal_id")?.notNull).toBe(false);
  });
});
