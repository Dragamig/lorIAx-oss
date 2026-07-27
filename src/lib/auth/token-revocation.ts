import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * H10 - Server-side session revocation.
 *
 * `users.tokenInvalidatedAt` was read at validation time but never written, so a
 * stolen or downgraded session stayed valid for the whole 24 h JWT lifetime. Every
 * credential or privilege change now stamps this column, and every session check
 * compares it with the `iat` claim of the presented JWT.
 *
 * The read is memoised for a few seconds: `auth()` runs on nearly every request and
 * the column changes very rarely. In-process writes clear the entry immediately, so
 * the stale window only exists across instances, which matches the behaviour of the
 * permission cache in `check-access.ts`.
 */

const CACHE_TTL_MS = 5_000;
const CACHE_MAX = 5_000;

interface CacheEntry {
  value: number | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Drop the memoised value for a user (called after every write). */
export function clearTokenInvalidationCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Timestamp (ms) before which any JWT issued for this user must be rejected,
 * or null when the user has never had their sessions revoked.
 */
export async function getTokenInvalidatedAt(userId: string): Promise<number | null> {
  const entry = cache.get(userId);
  if (entry && entry.expiresAt > Date.now()) return entry.value;

  const [row] = await db
    .select({ tokenInvalidatedAt: users.tokenInvalidatedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const value = row?.tokenInvalidatedAt ? row.tokenInvalidatedAt.getTime() : null;

  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });

  return value;
}

/**
 * Revoke every session issued so far for this user.
 *
 * Called on password reset and on global role change. The stamp is set one second in
 * the future to absorb the `iat` truncation to whole seconds in JWTs: a token issued
 * during the same second as the revocation must be rejected too.
 */
export async function invalidateUserSessions(userId: string): Promise<void> {
  const invalidatedAt = new Date(Date.now() + 1_000);

  await db
    .update(users)
    .set({ tokenInvalidatedAt: invalidatedAt, updatedAt: new Date() })
    .where(eq(users.id, userId));

  clearTokenInvalidationCache(userId);
}

/**
 * True when a JWT issued at `iatSeconds` (standard JWT claim, in seconds) predates
 * the revocation stamp of the user.
 */
export async function isTokenRevoked(
  userId: string,
  iatSeconds: number | undefined
): Promise<boolean> {
  const invalidatedAt = await getTokenInvalidatedAt(userId);
  if (invalidatedAt === null) return false;
  if (typeof iatSeconds !== "number") return false;

  return iatSeconds * 1000 < invalidatedAt;
}
