import { describe, it, expect, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ userDatabases: {} }));
vi.mock("@/lib/db/schema-ai-proposals", () => ({ aiToolCalls: {} }));
vi.mock("@/lib/auth/require-org-scoped", () => ({ requireOrgScoped: vi.fn(), OrgScopeError: class extends Error {} }));
vi.mock("@/lib/ai/proposals/store", () => ({ createProposal: vi.fn() }));
vi.mock("@/lib/ai/proposals/plan-update", () => ({ planUpdateRows: vi.fn() }));
vi.mock("@/lib/ai/proposals/plan-delete", () => ({ planDeleteRows: vi.fn() }));
vi.mock("@/lib/ai/proposals/plan-create", () => ({ planCreateRows: vi.fn() }));
vi.mock("@/lib/ai/proposals/plan-merge", () => ({ planMergeDuplicates: vi.fn() }));
vi.mock("@/lib/ai/creation/store", () => ({ createCreationProposal: vi.fn() }));
vi.mock("@/lib/ai/creation/enrich", () => ({ enrichPresentation: vi.fn() }));
vi.mock("../read-tools", () => ({
  buildReadTools: () => ({ list_databases: {}, describe_database: {}, query_rows: {}, find_duplicates: {} }),
}));

import { createChatTools } from "../index";
import { ALL_ON_CHAT_ACTIONS, type ChatActionsSettings } from "@/lib/ai/chat-actions-settings";
import type { ChatToolContext } from "../context";

const ctx = { user: { id: "u" }, orgId: "o", spaceIds: [], admin: false, req: {} as NextRequest } as unknown as ChatToolContext;
const CREATE = ["propose_create_document", "propose_create_presentation", "propose_create_spreadsheet"];
const NO_CREATE = { proposeSpreadsheets: false, proposeDocuments: false, proposePresentations: false };
const READ = ["describe_database", "find_duplicates", "list_databases", "list_my_mails", "query_rows"];
const names = (a?: Partial<ChatActionsSettings>) =>
  Object.keys(createChatTools(ctx, a ? { ...ALL_ON_CHAT_ACTIONS, ...a } : undefined)).sort();

describe("outils du chat selon le réglage de l'organisation", () => {
  it("par défaut : 4 lectures, 4 propositions et 3 créations", () => {
    expect(names()).toEqual(
      [...READ, ...CREATE, "propose_create_rows", "propose_delete_rows", "propose_merge_duplicates", "propose_update_rows"].sort(),
    );
  });

  it("maître éteint : aucun outil, même si les sous-options sont cochées", () => {
    expect(names({ actionsEnabled: false })).toEqual([]);
  });

  it("lecture éteinte : aucun outil (les propositions exigent la lecture)", () => {
    expect(names({ readDatabases: false })).toEqual(CREATE);
    expect(names({ readDatabases: false, ...NO_CREATE })).toEqual([]);
  });

  it("lecture seule : les 4 outils de lecture uniquement", () => {
    expect(
      names({ proposeUpdates: false, proposeDeletes: false, proposeMerges: false, proposeCreates: false, ...NO_CREATE }),
    ).toEqual(READ);
  });

  it.each([
    ["proposeUpdates", "propose_update_rows"],
    ["proposeDeletes", "propose_delete_rows"],
    ["proposeMerges", "propose_merge_duplicates"],
    ["proposeCreates", "propose_create_rows"],
  ] as const)("seul %s actif : une seule proposition, %s", (flag, tool) => {
    const off = { proposeUpdates: false, proposeDeletes: false, proposeMerges: false, proposeCreates: false, ...NO_CREATE };
    expect(names({ ...off, [flag]: true })).toEqual([...READ, tool].sort());
  });
});
