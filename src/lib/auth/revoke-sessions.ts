import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, users } from "@/lib/db/schema";
import { clearAuthUserStateCache } from "@/lib/auth";

/**
 * Coupe toutes les sessions ouvertes d'un compte : `tokenInvalidatedAt` borne
 * les jetons émis avant, et l'état mémoïsé du rappel `jwt` est purgé pour que
 * la révocation prenne effet sans attendre l'expiration du cache.
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenInvalidatedAt: new Date() })
    .where(eq(users.id, userId));
  clearAuthUserStateCache(userId);
}

/** Révoque les clés d'API `lrx_` encore actives du compte. */
export async function revokeUserApiKeys(userId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
}
