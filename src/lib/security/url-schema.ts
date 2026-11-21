import { z } from "zod";
import {
  validateExternalUrl,
  type ValidateExternalUrlOptions,
} from "@/lib/security/url-validator";

/**
 * Schéma d'une URL destinée à un appel sortant, à poser partout où une adresse
 * fournie par l'utilisateur est **stockée** avant d'être appelée plus tard.
 *
 * `z.string().url()` ne valide que la syntaxe : il accepte
 * `http://169.254.169.254/…` comme n'importe quelle adresse du réseau interne.
 * Le contrôle de forme doit donc être fait à l'écriture, en plus du contrôle
 * fait à l'émission (`safeExternalFetch`) : sans lui, une adresse interne
 * dort en base jusqu'au jour où un consommateur l'appelle sans précaution.
 *
 * Audit du 2026-08-19, constats INJ-07 et INJ-32.
 *
 * `options.allowPrivateTargets` lève le refus des adresses privées pour les
 * instances auto-hébergées (`WEBHOOK_ALLOW_PRIVATE_TARGETS`, cf. les routes
 * `api/v1/webhooks`). L'appelant doit passer une valeur déjà résolue : ce
 * fichier est isomorphe et ne doit jamais lire l'environnement lui-même.
 */
export function externalUrlSchema(
  maxLength = 2048,
  options?: ValidateExternalUrlOptions
) {
  return z
    .string()
    .url()
    .max(maxLength)
    .refine((value) => validateExternalUrl(value, options) === null, {
      message: options?.allowPrivateTargets
        ? "URL non autorisée : seules les adresses http ou https sont acceptées"
        : "URL non autorisée : seules les adresses publiques en http ou https sont acceptées",
    });
}
