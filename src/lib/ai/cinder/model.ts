import type { LanguageModel } from "ai";
import {
  getLanguageModelForUsageInOrg,
  getLanguageModelForUsageWithFallbackInOrg,
} from "@/lib/ai/provider-resolver";

export type CinderModel = {
  languageModel: LanguageModel;
  providerId: string | null;
  model: string;
  usageType: "chat" | "chat_database_actions";
};

/**
 * Modèle de Cinder, résolu dans la portée de l'organisation de la requête.
 * Modèle fiable dédié quand des outils sur les bases sont fournis (repli sur
 * « chat » sans assignation), sinon « chat ». Jamais l'usage « help ».
 */
export async function resolveCinderModel(input: {
  toolsAllowed: boolean;
  orgId: string | null;
}): Promise<CinderModel> {
  const { toolsAllowed, orgId } = input;
  const resolved = toolsAllowed
    ? await getLanguageModelForUsageWithFallbackInOrg("chat_database_actions", "chat", orgId)
    : await getLanguageModelForUsageInOrg("chat", orgId);
  const usageType =
    "usageType" in resolved && resolved.usageType === "chat_database_actions"
      ? "chat_database_actions"
      : "chat";
  return {
    languageModel: resolved.languageModel,
    providerId: resolved.providerId ?? null,
    model: resolved.model,
    usageType,
  };
}
