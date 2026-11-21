/**
 * Rate-limit pour les soumissions de formulaires publics.
 *
 * Backend Redis automatique si REDIS_URL est défini (multi-pod cloud),
 * fallback in-memory pour mono-process self-hosted. Le helper sous-jacent
 * (`checkRateLimitAsync`) gère les deux modes de façon transparente.
 *
 * Clé : `pubform:ip:<ip>:<token>` — seau par couple IP+token, 10/h.
 */

import { checkRateLimitAsync } from "@/lib/rate-limit";

const WINDOW_MS = 60 * 60 * 1000; // 1 heure
const MAX_PER_IP_PER_TOKEN = 10;

/**
 * Plafond appliqué au seau des soumissions SANS adresse identifiable.
 *
 * Sans adresse, aucune distinction entre clients n'est possible : le seau est
 * forcément commun. Le mettre dans le MÊME seau que les clients identifiés
 * ferait du plafond de 10/h un déni de service partagé, quelques requêtes
 * anonymes suffisant à fermer le formulaire à tout le monde (AZ-25). On isole
 * donc un seau distinct, et on le dote d'un plafond global par formulaire,
 * volontairement plus large pour ne pas casser un formulaire légitime, mais
 * borné pour que le remplissage en masse reste impossible.
 */
const MAX_PER_TOKEN_WITHOUT_IP = 100;

/**
 * @param ip Adresse du client, ou `null` si elle n'est pas déterminable.
 *   Ne JAMAIS passer la constante `UNKNOWN_CLIENT_IP` : elle serait indexée
 *   comme une adresse et mettrait tous les clients dans le même seau.
 */
export async function tryAllowSubmission(
  ip: string | null,
  token: string,
): Promise<boolean> {
  const key = ip ? `pubform:ip:${ip}:${token}` : `pubform:noip:${token}`;
  const result = await checkRateLimitAsync(key, {
    maxRequests: ip ? MAX_PER_IP_PER_TOKEN : MAX_PER_TOKEN_WITHOUT_IP,
    windowMs: WINDOW_MS,
  });
  return result.success;
}
