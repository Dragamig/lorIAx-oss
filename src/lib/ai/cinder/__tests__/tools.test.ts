import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Tool } from "ai";

const createChatTools = vi.fn();
const helpTools = vi.fn();

vi.mock("@/lib/ai/chat-tools", () => ({
  createChatTools: (...args: unknown[]) => createChatTools(...args),
}));
vi.mock("@/lib/modules/hooks", () => ({
  getHooks: () => ({ help: { tools: (u: unknown) => helpTools(u) } }),
}));
vi.mock("@/lib/ai/cinder/search-help-tool", () => ({
  createSearchHelpTool: () => "CORE_SEARCH_HELP",
}));

import { buildCinderTools } from "../tools";
import { ALL_ON_CHAT_ACTIONS } from "@/lib/ai/chat-actions-settings-shared";
import type { ChatToolContext } from "@/lib/ai/chat-tools/context";

const user = { id: "u1", email: "a@b.fr", name: "Ann" };
const ctx = {} as ChatToolContext;
const fake = (n: string) => n as unknown as Tool;

beforeEach(() => {
  createChatTools.mockReset().mockReturnValue({ query_rows: fake("CORE_QR"), other: fake("CORE_O") });
  helpTools.mockReset().mockReturnValue({ hook_tool: fake("HOOK_RB") });
});

describe("buildCinderTools", () => {
  it("full avec contexte", () => {
    const t = buildCinderTools({ scope: "full", user, toolsCtx: ctx, actions: ALL_ON_CHAT_ACTIONS });
    expect(Object.keys(t).sort()).toEqual(["hook_tool", "other", "query_rows", "search_help"]);
  });
  it("toolsCtx null", () => {
    const t = buildCinderTools({ scope: "full", user, toolsCtx: null, actions: ALL_ON_CHAT_ACTIONS });
    expect(Object.keys(t).sort()).toEqual(["hook_tool", "search_help"]);
    expect(createChatTools).not.toHaveBeenCalled();
  });
  it("hook neutre", () => {
    helpTools.mockReturnValue({});
    const t = buildCinderTools({ scope: "full", user, toolsCtx: null, actions: ALL_ON_CHAT_ACTIONS });
    expect(Object.keys(t)).toEqual(["search_help"]);
  });
  it("collision : le noyau l'emporte", () => {
    helpTools.mockReturnValue({ query_rows: fake("HOOK_QR"), search_help: fake("HOOK_SH") });
    const t = buildCinderTools({ scope: "full", user, toolsCtx: ctx, actions: ALL_ON_CHAT_ACTIONS });
    expect(t.query_rows).toBe("CORE_QR");
    expect(t.search_help).toBe("CORE_SEARCH_HELP");
  });
  it("help-alias n'appelle jamais createChatTools", () => {
    const t = buildCinderTools({ scope: "help-alias", user, toolsCtx: ctx, actions: ALL_ON_CHAT_ACTIONS });
    expect(createChatTools).not.toHaveBeenCalled();
    expect(Object.keys(t).sort()).toEqual(["hook_tool", "search_help"]);
  });
  it("identité du hook", () => {
    buildCinderTools({
      scope: "full",
      user: { id: "u1", email: "a@b.fr", name: "Ann", extra: "x" } as typeof user,
      toolsCtx: null,
      actions: ALL_ON_CHAT_ACTIONS,
    });
    expect(helpTools).toHaveBeenCalledWith({ id: "u1", email: "a@b.fr", name: "Ann" });
  });
});
