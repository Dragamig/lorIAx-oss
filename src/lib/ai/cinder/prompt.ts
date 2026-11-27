import { getSystemPrompt, interpolatePrompt } from "@/lib/ai/prompt-resolver";
import { withChatGuardrails } from "@/lib/ai/chat-guardrails";
import type { ChatActionsSettings } from "@/lib/ai/chat-actions-settings";
import { getHooks } from "@/lib/modules/hooks";

export interface CinderPromptInput {
  ragBlock: string;
  pageContext: string;
  hasTools: boolean;
  actions: ChatActionsSettings;
}

/**
 * Prompt système de Cinder : prompt `chat` (builtin ou surchargé en base),
 * garde-fous non surchargeables, puis consignes d'aide issues des hooks
 * (l'édition communautaire reste muette sur le signalement).
 */
export async function buildCinderSystemPrompt(
  input: CinderPromptInput,
): Promise<{ system: string; versionId?: string }> {
  const { prompt, versionId } = await getSystemPrompt("chat");
  const base = withChatGuardrails(
    interpolatePrompt(prompt, {
      contexte_rag: input.ragBlock,
      contexte_additionnel: input.pageContext,
    }),
    { hasTools: input.hasTools, actions: input.actions },
  );
  const help = getHooks().help;
  const helpRules = `AIDE PRODUIT :
- Si l'information n'existe pas dans la documentation, dis-le et invite l'utilisateur à reformuler sa question${help.unansweredHint()}.${help.systemPromptAddendum()}`;
  return { system: `${base}\n\n${helpRules}`, versionId };
}
