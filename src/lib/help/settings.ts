import { getSetting } from "@/lib/settings/system-settings";

/**
 * Indique si l'assistant d'aide produit est activé.
 *
 * Piloté par le réglage admin `help_assistant_enabled` (system_settings).
 * Activé par défaut quand le réglage n'a jamais été défini.
 */
export async function isHelpAssistantEnabled(): Promise<boolean> {
  const value = await getSetting<boolean>("help_assistant_enabled");
  return value !== false;
}
