import "server-only";
import { getSetting, setSetting } from "@/lib/settings/system-settings";
import type { ProposalPayload } from "@/lib/ai/proposals/types";
import {
  ALL_OFF_CHAT_ACTIONS,
  chatActionsKey,
  normalizeChatActionsSettings,
  parseChatActionsSettings,
  type ChatActionsSettings,
} from "@/lib/ai/chat-actions-settings-shared";

// Réexport pour les imports serveur existants. Les composants client importent le module partagé.
export * from "@/lib/ai/chat-actions-settings-shared";

/** Réglage tel que stocké pour l'écran d'administration (sous-options conservées). */
export async function getStoredChatActionsSettings(orgId: string): Promise<ChatActionsSettings> {
  return parseChatActionsSettings(await getSetting<unknown>(chatActionsKey(orgId)));
}

/**
 * Réglage effectif d'une organisation. Absent en base : défauts. Erreur de
 * lecture : tout éteint (fail-closed), jamais une ouverture accidentelle.
 */
export async function getChatActionsSettings(orgId: string): Promise<ChatActionsSettings> {
  try {
    return normalizeChatActionsSettings(await getSetting<unknown>(chatActionsKey(orgId)));
  } catch {
    return { ...ALL_OFF_CHAT_ACTIONS };
  }
}

export async function saveChatActionsSettings(
  orgId: string,
  value: ChatActionsSettings,
): Promise<void> {
  await setSetting(chatActionsKey(orgId), parseChatActionsSettings(value));
}

const PAYLOAD_FLAG: Record<ProposalPayload["type"], keyof ChatActionsSettings> = {
  update_rows: "proposeUpdates",
  delete_rows: "proposeDeletes",
  merge_duplicates: "proposeMerges",
  create_rows: "proposeCreates",
};

/** Le type d'action d'une proposition est-il encore autorisé par le réglage de l'organisation ? */
export async function isProposalTypeAllowed(
  orgId: string,
  type: ProposalPayload["type"],
): Promise<boolean> {
  const settings = await getChatActionsSettings(orgId);
  return settings[PAYLOAD_FLAG[type]];
}

export const PROPOSAL_TYPE_DISABLED_MESSAGE =
  "Cette action a été désactivée par l'administrateur, la proposition ne peut plus être appliquée";
