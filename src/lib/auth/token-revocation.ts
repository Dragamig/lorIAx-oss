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

/**
 * Etat de revocation d'un compte.
 *
 * `exists: false` est un etat a part entiere, et non l'absence de borne : un compte
 * supprime doit rejeter TOUTES ses sessions, pas les laisser vivre jusqu'a
 * l'expiration du JWT. C'est le scenario du depart d'un salarie, donc le cas d'usage
 * numero un d'une revocation de session.
 */
type RevocationState =
  | { exists: false }
  | { exists: true; invalidatedAt: number | null };

interface CacheEntry {
  value: RevocationState;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/** Drop the memoised value for a user (called after every write). */
export function clearTokenInvalidationCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Existence du compte, et borne (ms) avant laquelle tout JWT emis pour lui doit
 * etre rejete.
 */
export async function getRevocationState(userId: string): Promise<RevocationState> {
  const entry = cache.get(userId);
  if (entry && entry.expiresAt > Date.now()) return entry.value;

  const [row] = await db
    .select({ tokenInvalidatedAt: users.tokenInvalidatedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const value: RevocationState = row
    ? {
        exists: true,
        invalidatedAt: row.tokenInvalidatedAt ? row.tokenInvalidatedAt.getTime() : null,
      }
    : { exists: false };

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
 * Vrai quand le jeton doit etre rejete : compte supprime, ou jeton emis (claim JWT
 * `iat`, en secondes) avant la borne de revocation du compte.
 */
export async function isTokenRevoked(
  userId: string,
  iatSeconds: number | undefined
): Promise<boolean> {
  const state = await getRevocationState(userId);

  // Compte supprime : plus aucune session ne doit etre honoree. Sans ce test, le
  // JWT d'un compte supprime restait pleinement valide jusqu'a 24 h.
  if (!state.exists) return true;

  if (state.invalidatedAt === null) return false;
  if (typeof iatSeconds !== "number") return false;

  return iatSeconds * 1000 < state.invalidatedAt;
}
