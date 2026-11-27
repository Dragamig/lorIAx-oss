/**
 * Valeur effective de `system_settings.auth.allowRegistration`.
 * Source unique partagee par la politique serveur (`registration-policy.ts`) et
 * par la lecture des reglages de l'ecran d'administration.
 *
 * Fermee sauf `true` explicite, dans les deux editions : la fusion de main
 * (AZ-27, 2026-11-20) a ferme l'inscription par defaut, y compris en
 * commercial (echec ferme, `isRegistrationOpen`). L'edition oss ajoute en plus
 * l'exigence d'un super administrateur (`registration-policy.ts`).
 */
export function resolveAllowRegistration(stored: unknown): boolean {
  return stored === true;
}
