import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

/** Locale de la requête : cookie NEXT_LOCALE validé, sinon la locale par défaut. Partagé par activate et preview. */
export function requestLocale(req: NextRequest): Locale {
  const value = req.cookies.get("NEXT_LOCALE")?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
