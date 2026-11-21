// src/lib/setup/constants.ts
/**
 * Constantes partagées entre le serveur (garde d'amorçage) et le navigateur
 * (point d'appel unique de l'assistant). Isolées de `bootstrap-token.ts`, qui
 * importe la base de données et `next/server` : un composant client ne doit
 * pas tirer tout cela dans son paquet pour connaître le nom d'un en-tête.
 */

/** Clé de persistance du jeton engendré dans `system_settings`. */
export const SETUP_TOKEN_KEY = "setup_bootstrap_token";
/** En-tête accepté pour présenter le jeton d'amorçage. */
export const SETUP_TOKEN_HEADER = "x-setup-token";
/** Cookie posé par `/api/setup/authorize` une fois le jeton validé. */
export const SETUP_TOKEN_COOKIE = "setup_bootstrap";
/** Durée de vie du cookie d'amorçage (2 h, le temps de dérouler l'assistant). */
export const SETUP_COOKIE_MAX_AGE = 2 * 60 * 60;
