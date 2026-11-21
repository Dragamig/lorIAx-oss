"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { LocaleSchema } from "@/i18n/config";
import logger from "@/lib/logger";

const COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // ~1 an

export async function setUserLocale(locale: string): Promise<void> {
  const parsed = LocaleSchema.safeParse(locale);
  if (!parsed.success) {
    throw new Error(`Locale invalide : ${locale}`);
  }

  const validLocale = parsed.data;

  // Persister le cookie NEXT_LOCALE (convention next-intl)
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, validLocale, {
    path: "/",
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: false, // lisible côté client si besoin
  });

  // Mettre à jour la BDD pour l'utilisateur authentifié (best-effort)
  const user = await getSessionUser();
  if (user) {
    try {
      await db
        .update(users)
        .set({ locale: validLocale })
        .where(eq(users.id, user.id));
    } catch (err) {
      logger.error({ err, userId: user.id, locale: validLocale }, "setUserLocale: DB update failed (best-effort)");
    }
  }
}
