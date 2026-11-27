/**
 * RÈGLE DE CYCLE D'IMPORT (Tâches 13 à 19) : ce fichier importe statiquement le baril
 * `hooks.server.generated`, qui importe les fichiers `register` des modules, lesquels
 * importent `registerHooks` d'ici. Le cycle ne fonctionne que si un fichier `register`
 * n'utilise JAMAIS un export de `hooks.ts` au niveau supérieur du module : seulement dans
 * le corps de sa fonction exportée (appelée par `getHooks()` après l'évaluation complète).
 * Interdit : `registerHooks(...)` ou `NEUTRAL_HOOKS` à l'évaluation du module.
 */
import type { Tool } from "ai";
import { registerIncludedModuleHooks } from "./hooks.server.generated";
import { resetEnvHooksForTests } from "./hooks.env";
import { resetHttpHooksForTests } from "./hooks.http";

export type { EnvHooks } from "./hooks.env";
export type { HttpHooks } from "./hooks.http";

/** Verdict d'usage face à un plafond. `max: null` = pas de plafond, jamais dépassé. */
export interface UsageStatus {
  current: number;
  max: number | null;
  exceeded: boolean;
  /** 0 quand il n'y a pas de plafond. */
  percentage: number;
}

export interface UsageHooks {
  checkUsersLimit(orgId: string): Promise<UsageStatus>;
  checkSpacesLimit(orgId: string): Promise<UsageStatus>;
  getOrgStorageLimitBytes(orgId: string): Promise<number | null>;
  /**
   * Offre effective de l'organisation (une offre échue compte comme `free`).
   * Neutre : `null`, aucune offre donc aucun plafond lié à l'offre (quota d'envoi de mails).
   */
  getOrgPlan(orgId: string): Promise<"free" | "growth" | "enterprise" | null>;
}

/**
 * Fonctionnalités gardées. Copie volontaire de `Feature` (src/lib/license, retiré de
 * l'édition open source) ; l'assignabilité est vérifiée dans src/lib/license/hooks-contract.test.ts.
 */
export type FeatureName =
  | "sso"
  | "audit_log"
  | "custom_branding"
  | "ai_advanced"
  | "api_access"
  | "scim"
  | "ha_cluster"
  | "white_label";

/** Licence sérialisable pour le client (miroir de `getLicenseForClient` de src/lib/license). */
export interface ClientLicense {
  plan: "free" | "growth" | "enterprise";
  valid: boolean;
  expired: boolean;
  gracePeriod: boolean;
  customerEmail?: string;
  /** Timestamp Unix en secondes. */
  expiresAt?: number;
}

export interface EntitlementHooks {
  /**
   * `null` = tout module compilé est autorisé. `orgId` absent ou `null` : aucun scope
   * organisation, seule la licence d'instance décide (mono-tenant, administration d'instance).
   */
  getEntitledModuleIds(orgId?: string | null): Promise<Set<string> | null>;
  hasFeature(feature: string): Promise<boolean>;
  /** Enveloppe un gestionnaire de route : neutre = passe-plat. */
  requireFeature(
    feature: FeatureName,
  ): <A extends unknown[], R>(handler: (...args: A) => Promise<R>) => (...args: A) => Promise<R>;
  isFreePlan(): Promise<boolean>;
}

export interface LifecycleHooks {
  start(): Promise<void>;
}

/** Identite de l'utilisateur de session, transmise aux outils d'aide (jamais saisie par le modele). */
export interface HelpUser {
  id: string;
  email: string;
  name?: string;
}

export interface HelpHooks {
  tools(user: HelpUser): Record<string, Tool>;
  systemPromptAddendum(): string;
  /** Fragment insere avant le point final de la regle 1 (question sans reponse). Neutre : vide. */
  unansweredHint(): string;
}

/** Hooks serveur (baril serveur). Les hooks `env` et `http` vivent dans leurs feuilles. */
export interface ModuleHooks {
  usage: UsageHooks;
  entitlements: EntitlementHooks;
  lifecycle: LifecycleHooks;
  help: HelpHooks;
  /** Licence sérialisable pour le client. Code serveur : neutre = `null`. */
  getLicenseForClient(): Promise<ClientLicense | null>;
}

const NEUTRAL_USAGE: UsageStatus = { current: 0, max: null, exceeded: false, percentage: 0 };

export const NEUTRAL_HOOKS: ModuleHooks = {
  usage: {
    checkUsersLimit: async () => ({ ...NEUTRAL_USAGE }),
    checkSpacesLimit: async () => ({ ...NEUTRAL_USAGE }),
    getOrgStorageLimitBytes: async () => null,
    getOrgPlan: async () => null,
  },
  entitlements: {
    getEntitledModuleIds: async () => null,
    hasFeature: async () => true,
    requireFeature: () => (handler) => handler,
    isFreePlan: async () => false,
  },
  lifecycle: { start: async () => {} },
  help: { tools: () => ({}), systemPromptAddendum: () => "", unansweredHint: () => "" },
  getLicenseForClient: async () => null,
};

export type HooksRegistration = {
  [K in keyof ModuleHooks]?: ModuleHooks[K] extends (...a: never[]) => unknown
    ? ModuleHooks[K]
    : Partial<ModuleHooks[K]>;
};

let current: ModuleHooks = NEUTRAL_HOOKS;
let barrelLoaded = false;

/** Fusion par groupe : seuls les champs fournis remplacent les valeurs neutres. */
export function registerHooks(partial: HooksRegistration): void {
  const next = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(partial)) {
    if (value === undefined) continue;
    const base = next[key];
    next[key] =
      typeof value === "function" || typeof base === "function"
        ? value
        : { ...(base as object), ...(value as object) };
  }
  current = next as unknown as ModuleHooks;
}

/** Hooks courants. Le baril généré est chargé une seule fois, à la première lecture. */
export function getHooks(): ModuleHooks {
  if (!barrelLoaded) {
    barrelLoaded = true;
    registerIncludedModuleHooks();
  }
  return current;
}

/** Revient aux valeurs neutres sans recharger le baril (un module absent le reste). */
export function resetHooksForTests(): void {
  barrelLoaded = true;
  current = NEUTRAL_HOOKS;
  resetEnvHooksForTests();
  resetHttpHooksForTests();
}
