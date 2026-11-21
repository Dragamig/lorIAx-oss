import { NextResponse } from "next/server";
import { isHelpAssistantEnabled } from "@/lib/help/settings";
import { isAiConfiguredForAssistant } from "@/lib/ai/provider-resolver";

/**
 * Indique au client si le bouton d'assistant d'aide doit être affiché.
 * Auth non nécessaire : ne renvoie que des booléens de configuration produit.
 * `aiConfigured` = false ⇒ aucune IA disponible : le bouton reste masqué pour
 * ne pas proposer un assistant qui ne pourrait jamais répondre.
 */
export async function GET() {
  const [enabled, aiConfigured] = await Promise.all([
    isHelpAssistantEnabled(),
    isAiConfiguredForAssistant(),
  ]);
  return NextResponse.json({ enabled, aiConfigured });
}
