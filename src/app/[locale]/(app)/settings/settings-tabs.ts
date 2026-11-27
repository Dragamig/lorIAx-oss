import { Settings, Key, Webhook, CreditCard, Mail } from "lucide-react";
import { getClientSlots } from "@/lib/modules/hooks.client";

const ALL_SETTINGS_TABS = [
  { id: "general", label: "Général", icon: Settings },
  { id: "api-keys", label: "Clés API", icon: Key },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "subscription", label: "Abonnement", icon: CreditCard },
  { id: "mailbox", label: "Ma boîte mail", icon: Mail },
] as const;

export type SettingsTabId = (typeof ALL_SETTINGS_TABS)[number]["id"];

/** Onglets des réglages ; « Abonnement » n'existe que si un module fournit le slot. */
export function getSettingsTabs() {
  const hasSubscription = getClientSlots().SubscriptionTab !== null;
  return ALL_SETTINGS_TABS.filter((t) => t.id !== "subscription" || hasSubscription);
}
