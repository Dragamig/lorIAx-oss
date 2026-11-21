import { RUNTIME_ASSEMBLY_HASH } from "./runtime-assembly";

/**
 * Version du runtime de présentation servie par l'application.
 *
 * Elle apparaît dans l'URL de l'iframe, ce qui rend la réponse cachable
 * indéfiniment, et elle est écrite dans la charge utile de chaque présentation
 * enregistrée : on saura toujours avec quel moteur un document a été produit,
 * ce qui est la seule façon de rattraper une dérive de format amont.
 *
 * Monter cette version est un lot à part entière : nouvel artefact dans
 * `vendor/bento/<version>/`, ajout ici, et relecture d'un jeu de présentations
 * de référence. Jamais une mise à jour silencieuse.
 */
export const BENTO_RUNTIME_VERSION = "1.0.19";

/**
 * Versions servies, c'est-à-dire réellement déposées dans `vendor/bento/`.
 * La route de service n'accepte un segment d'URL comme chemin de fichier
 * qu'après l'avoir reconnu dans cette liste fermée.
 */
export const KNOWN_RUNTIME_VERSIONS = new Set([BENTO_RUNTIME_VERSION]);

/**
 * Correspondance entre nos locales et les catalogues embarqués du runtime.
 *
 * Le runtime en embarque neuf, qui ne recouvrent pas exactement nos sept. Le
 * breton n'existe pas côté moteur : ses menus internes seront en anglais, tout
 * le cadre que nous dessinons autour restant traduit. C'est la divergence
 * acceptée à la conception, et elle s'arrête aux menus de l'éditeur.
 */
const RUNTIME_LOCALES: Record<string, string> = {
  fr: "fr",
  en: "en",
  es: "es",
  de: "de",
  ja: "ja",
  zh: "zh-Hans",
  br: "en",
};

/** Catalogue du runtime pour une locale de l'application. */
export function runtimeLocale(locale: string): string {
  return RUNTIME_LOCALES[locale] ?? "en";
}

/**
 * URL de l'iframe.
 *
 * La langue voyage dans l'URL et non dans le message `load` : le runtime
 * choisit son catalogue au démarrage et ne redessine pas les menus déjà
 * construits, une bascule postérieure laisserait donc une interface panachée.
 * Le prix est une entrée de cache par langue, soit sept au plus.
 */
export function runtimeUrl(
  locale: string,
  version: string = BENTO_RUNTIME_VERSION
): string {
  return `/api/presentations/runtime/${version}?lang=${runtimeLocale(locale)}&b=${RUNTIME_ASSEMBLY_HASH}`;
}
