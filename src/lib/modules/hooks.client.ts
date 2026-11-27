import type { ComponentType, ReactNode } from "react";
import type { ClientLicense } from "./hooks";
import { registerIncludedModuleHooks } from "./hooks.client.generated";

/**
 * RÈGLE DE CYCLE D'IMPORT (Tâches 13 à 19) : ce fichier importe le baril client, dont les
 * fichiers `register` importent `registerClientSlots` d'ici. Un `register` ne doit l'appeler
 * que dans le corps de sa fonction exportée, jamais au niveau supérieur du module.
 * L'import de `./hooks` ci-dessus est un `import type`, effacé à la compilation.
 */

/**
 * Onglet d'administration contribué par un module : même forme que l'onglet du noyau
 * (import de type seulement, effacé à la compilation, aucun import serveur ici).
 * `after` : href de l'onglet après lequel insérer ; absent ou inconnu, juste avant « Système ».
 */
export type AdminTabSlot = import("@/components/admin/admin-tabs").Tab & { after?: string };

export interface ClientSlots {
  /** Fournit le contexte de licence côté client. Neutre : passe-plat, sans contexte. */
  LicenseProvider: ComponentType<{ license?: ClientLicense | null; children: ReactNode }>;
  /** Onglet d'abonnement des réglages. Neutre : `null` (onglet absent). */
  SubscriptionTab: ComponentType<{ currentPlan: string; memberCount: number }> | null;
  adminTabs: AdminTabSlot[];
  /** Sélecteur et création d'organisation dans la barre latérale. Neutre : `null` (rien affiché, aucun appel réseau). */
  OrgSwitcher: ComponentType | null;
  /** Lien d'inscription cloud (création d'organisation) sur les pages d'authentification. Neutre : `null` (rien affiché). */
  CloudSignupLink: ComponentType | null;
  /** Suggestion et mention de signalement de bug dans l'assistant d'aide. Neutre : false. */
  helpBugReport: boolean;
}

const PassThrough: ClientSlots["LicenseProvider"] = ({ children }) => children;

export const NEUTRAL_CLIENT_SLOTS: ClientSlots = {
  LicenseProvider: PassThrough,
  SubscriptionTab: null,
  adminTabs: [],
  OrgSwitcher: null,
  CloudSignupLink: null,
  helpBugReport: false,
};

let current: ClientSlots = NEUTRAL_CLIENT_SLOTS;
let barrelLoaded = false;

export function registerClientSlots(partial: Partial<ClientSlots>): void {
  const defined = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined));
  current = { ...current, ...defined };
}

export function getClientSlots(): ClientSlots {
  if (!barrelLoaded) {
    barrelLoaded = true;
    registerIncludedModuleHooks();
  }
  return current;
}

export function resetClientSlotsForTests(): void {
  barrelLoaded = true;
  current = NEUTRAL_CLIENT_SLOTS;
}
