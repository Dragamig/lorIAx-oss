import type { Tool } from "ai";
import { createChatTools } from "@/lib/ai/chat-tools";
import type { ChatToolContext } from "@/lib/ai/chat-tools/context";
import type { ChatActionsSettings } from "@/lib/ai/chat-actions-settings-shared";
import { getHooks, type HelpUser } from "@/lib/modules/hooks";
import { createSearchHelpTool } from "./search-help-tool";
import type { CinderScope } from "./types";

type Input = {
  scope: CinderScope;
  user: HelpUser;
  /** Non null only when database tools are allowed (decided by the engine). */
  toolsCtx: ChatToolContext | null;
  actions: ChatActionsSettings;
};

/**
 * Assembles Cinder's tools. Precedence: core tools override hook tools.
 * Hook tool names come from the hook, never hard-coded here.
 */
export function buildCinderTools({ scope, user, toolsCtx, actions }: Input): Record<string, Tool> {
  const hookTools = getHooks().help.tools({ id: user.id, email: user.email, name: user.name });
  const dbTools = scope === "full" && toolsCtx ? createChatTools(toolsCtx, actions) : {};
  return {
    ...hookTools,
    ...(dbTools as Record<string, Tool>),
    search_help: createSearchHelpTool(user.id),
  };
}
