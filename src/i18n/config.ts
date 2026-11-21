import { z } from "zod";

export const LOCALES = ["fr", "en", "es", "de", "ja", "zh", "br"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "fr";

export const LocaleSchema = z.enum(LOCALES);

export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français", // i18n-ignore (endonyme)
  en: "English",
  es: "Español",
  de: "Deutsch",
  ja: "日本語",
  zh: "简体中文",
  br: "Brezhoneg (beta)",
};

// Utilisé côté serveur (Stage 6 : emails, prompts IA) pour valider users.locale hors contexte zod
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
