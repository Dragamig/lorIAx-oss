import type { ChatToolContext } from "./context";
import { buildReadTools } from "./read-tools";
import { buildWriteTools } from "./write-tools";
import { buildMailTools } from "./mail-tools";
import { buildCreateTools } from "./create-tools";
import {
  ALL_ON_CHAT_ACTIONS,
  resolveEffectiveChatActions,
  type ChatActionsSettings,
} from "@/lib/ai/chat-actions-settings";

/**
 * Outils du chat, filtrés par le réglage de l'organisation : maître éteint =
 * aucun outil, lecture éteinte = aucune proposition, chaque propose_* selon son
 * interrupteur. Sans réglage fourni, tout est inclus.
 */
export function createChatTools(
  ctx: ChatToolContext,
  actions: ChatActionsSettings = ALL_ON_CHAT_ACTIONS,
) {
  const eff = resolveEffectiveChatActions(actions);
  if (!eff.actionsEnabled) return {};
  // Création de fichiers : indépendante de la lecture des bases.
  const create = buildCreateTools(ctx, eff);
  if (!eff.readDatabases) return create;
  return { ...buildReadTools(ctx), ...buildMailTools(ctx), ...buildWriteTools(ctx, eff), ...create };
}
