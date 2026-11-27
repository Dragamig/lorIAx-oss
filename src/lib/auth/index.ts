import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { organizations, organizationMembers } from "@/lib/db/schema-org";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import type { SessionUser } from "@/types";
import logger from "@/lib/logger";
import { INCLUDED_MODULE_IDS } from "@/lib/modules/registry.generated";
import { EmailNotVerifiedError } from "@/lib/auth/errors";
import {
  AUTH_ACCOUNT_TIERS,
  AUTH_FAILURE_TIERS,
  AUTH_IP_TIERS,
  authIdentityBucket,
  consumeQuota,
  getClientIpOrNull,
  ipKeyPart,
  peekQuotaExceeded,
  resetQuota,
} from "@/lib/rate-limit";

// ─── AZ-04 : limitation de débit et verrouillage progressif de la connexion ──

/**
 * Arbitrage retenu sur le verrouillage de la connexion.
 *
 * La première version d'AZ-04 indexait le seau sur la seule empreinte de
 * l'adresse électronique, comptait TOUTES les tentatives et ne remettait jamais
 * le compteur à zéro. N'importe quel tiers pouvait donc fermer la connexion
 * d'une victime en permanence, avec vingt requêtes par heure portant son
 * adresse et un mot de passe quelconque : la victime n'y pouvait rien et ne
 * comprenait rien, le refus étant volontairement indistinguable d'un mot de
 * passe faux. Un déni de service offert à tous est pire que le bourrage
 * d'identifiants qu'on cherchait à fermer.
 *
 * L'arbitrage classique se pose ainsi : verrouiller par COMPTE protège du
 * bourrage d'identifiants mais offre ce déni de service ciblé ; verrouiller par
 * ADRESSE seule ne protège pas d'un attaquant distribué. Le compromis retenu
 * combine trois dimensions et ne compte que les ÉCHECS :
 *
 *  1. paliers serrés sur le COUPLE compte + adresse cliente : le frein mord là
 *     où l'attaquant se trouve, et le seau de la victime, qui se connecte
 *     depuis une autre adresse, reste intact ;
 *  2. palier de secours très large sur le COMPTE seul (cent échecs par heure) :
 *     il rattrape l'attaque distribuée sans rendre le déni de service ciblé
 *     gratuit ;
 *  3. paliers larges sur l'ADRESSE seule : ils rattrapent le balayage d'un
 *     attaquant qui change de compte à chaque tentative.
 *
 * Et surtout : une authentification RÉUSSIE remet les seaux du compte à zéro.
 * L'utilisateur légitime qui finit par retrouver son mot de passe repart avec
 * un compteur neuf ; l'attaquant, qui n'y arrive pas, reste bloqué.
 *
 * Le déni de service processeur, l'autre motif d'AZ-04, reste fermé : la
 * consultation des seaux se fait AVANT toute lecture en base et avant tout
 * calcul bcrypt, et un échec consomme un jeton. Un attaquant ne peut donc
 * provoquer que cinq calculs bcrypt par minute et par couple compte+adresse.
 */
const LOGIN_COUPLE_TIERS = AUTH_FAILURE_TIERS;
const LOGIN_ACCOUNT_TIERS = AUTH_ACCOUNT_TIERS;
const LOGIN_IP_TIERS = AUTH_IP_TIERS;

/**
 * Adresse IP du client de la tentative de connexion.
 *
 * Deux précautions :
 *  - le fournisseur d'identifiants de NextAuth reçoit la requête d'origine en
 *    second argument (cf. `CredentialsConfig.authorize`), mais elle peut être
 *    absente selon le point d'appel ; on ne suppose rien ;
 *  - l'extraction passe par `getClientIpOrNull`, qui rend `null` plutôt que la
 *    constante `UNKNOWN_CLIENT_IP` quand aucune adresse n'est déterminable
 *    (AZ-25). Indexer cette constante comme une adresse mettrait tous les
 *    clients anonymes dans le même seau.
 */
function resolveLoginIp(request?: unknown): string | null {
  const req = request as Request | undefined;
  if (!req || typeof req.headers?.get !== "function") return null;
  return getClientIpOrNull(req);
}

/** Les trois clés de quota d'une tentative de connexion. */
function loginQuotaKeys(email: string, request?: unknown) {
  const bucket = authIdentityBucket(email);
  const ip = resolveLoginIp(request);
  return {
    bucket,
    /** Palier serré : compte + adresse cliente. */
    couple: `login:acct:${bucket}:${ipKeyPart(ip)}`,
    /** Palier de secours large : compte seul. */
    account: `login:acct:${bucket}`,
    /** Palier par adresse seule, sauté quand l'adresse est indéterminable. */
    ip: ip ? `login:${ipKeyPart(ip)}` : null,
  };
}

/**
 * Dit si la tentative de connexion en cours doit être refusée d'emblée.
 *
 * Consultation SEULE : aucun jeton n'est consommé ici. C'est ce qui permet à
 * une authentification réussie de ne rien coûter, donc à un utilisateur
 * légitime de ne jamais se verrouiller lui-même.
 *
 * Appelée AVANT toute lecture en base et avant tout calcul bcrypt : c'est ce
 * qui ferme le déni de service processeur décrit par AZ-04.
 *
 * Passe par les helpers asynchrones (donc Redis quand `REDIS_URL` est défini)
 * et non par la variante synchrone, qui ignore Redis par construction et
 * multiplierait les quotas par le nombre de répliques (AZ-26).
 */
export async function isLoginQuotaExceeded(
  email: string,
  request?: unknown
): Promise<boolean> {
  const keys = loginQuotaKeys(email, request);

  if (await peekQuotaExceeded(keys.couple, LOGIN_COUPLE_TIERS)) return true;
  if (await peekQuotaExceeded(keys.account, LOGIN_ACCOUNT_TIERS)) return true;
  if (keys.ip && (await peekQuotaExceeded(keys.ip, LOGIN_IP_TIERS))) return true;

  return false;
}

/** Comptabilise un échec d'authentification sur les trois dimensions. */
async function recordLoginFailure(email: string, request?: unknown): Promise<void> {
  const keys = loginQuotaKeys(email, request);
  await consumeQuota(keys.couple, LOGIN_COUPLE_TIERS);
  await consumeQuota(keys.account, LOGIN_ACCOUNT_TIERS);
  if (keys.ip) await consumeQuota(keys.ip, LOGIN_IP_TIERS);
}

/**
 * Remet à zéro les seaux du COMPTE après une authentification réussie.
 *
 * Le seau par adresse seule n'est délibérément PAS remis à zéro : un attaquant
 * disposant d'un compte à lui pourrait sinon effacer son propre compteur
 * d'échecs entre deux salves de balayage.
 */
async function resetLoginQuota(email: string, request?: unknown): Promise<void> {
  const keys = loginQuotaKeys(email, request);
  await resetQuota(keys.couple, LOGIN_COUPLE_TIERS);
  await resetQuota(keys.account, LOGIN_ACCOUNT_TIERS);
}

/**
 * Vérification des identifiants.
 *
 * Un refus pour cause de quota rend exactement la même chose qu'un mot de
 * passe faux (`null`) : NextAuth produit alors la même erreur `CredentialsSignin`
 * et la même redirection. Les seaux étant indexés sur l'adresse soumise, qu'un
 * compte existe ou non derrière elle, un attaquant qui énumère ne peut rien
 * déduire de la réponse.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<"email" | "password", unknown>>,
  request?: unknown
) {
  if (!credentials?.email || !credentials?.password) return null;

  const email = (credentials.email as string).toLowerCase().trim();
  const password = credentials.password as string;

  // Étape 0 : quota. Avant la base, avant bcrypt.
  if (await isLoginQuotaExceeded(email, request)) {
    logger.warn(
      { emailBucket: authIdentityBucket(email) },
      "[auth] Tentative de connexion refusée : quota dépassé"
    );
    return null;
  }

  const user = await verifyCredentials(email, password);

  // Correct local password but unverified email: neither a password failure
  // nor a success, so no quota is consumed or reset.
  if (user && "unverified" in user) throw new EmailNotVerifiedError();

  if (user) {
    await resetLoginQuota(email, request);
    return user;
  }

  await recordLoginFailure(email, request);
  return null;
}

/** Vérification proprement dite, locale puis LDAP. Ne touche pas aux quotas. */
async function verifyCredentials(email: string, password: string) {
  // Step 1: Try local auth
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (user?.passwordHash) {
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (isValid) {
      // Strict null check: undefined (legacy rows, mocks) counts as verified.
      if (user.emailVerifiedAt === null) return { unverified: true as const };
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.avatarUrl,
      };
    }
  }

  // Step 2: si l'auth locale échoue, tenter LDAP — module optionnel,
  // physiquement absent quand non acheté. Import dynamique gardé par
  // l'allowlist (cast `as string` -> tsc ne résout pas le chemin pruné).
  if (!INCLUDED_MODULE_IDS.includes("ldap")) return null;
  try {
    const ldapSpec = "./ldap";
    const ldapSyncSpec = "./ldap-sync";
    const { getLdapConfig, ldapAuthenticate } = (await import(
      ldapSpec as string
    )) as {
      getLdapConfig: () => Promise<{ ldapEnabled: boolean }>;
      ldapAuthenticate: (email: string, password: string) => Promise<unknown>;
    };
    const { syncLdapUser } = (await import(ldapSyncSpec as string)) as {
      syncLdapUser: (ldapUser: unknown) => Promise<{
        id: string;
        email: string;
        name: string | null;
        avatarUrl: string | null;
      }>;
    };

    const ldapConfig = await getLdapConfig();
    if (!ldapConfig.ldapEnabled) return null;

    const ldapUser = await ldapAuthenticate(email, password);
    if (!ldapUser) return null;

    const syncedUser = await syncLdapUser(ldapUser);
    return {
      id: syncedUser.id,
      email: syncedUser.email,
      name: syncedUser.name,
      image: syncedUser.avatarUrl,
    };
  } catch (err) {
    logger.error({ err }, "Erreur authentification LDAP");
    return null;
  }
}

// ─── AZ-05 / AZ-38 : état serveur relu à chaque rafraîchissement du jeton ────

interface AuthUserState {
  globalRole: (typeof users.$inferSelect)["globalRole"];
  capabilities: (typeof users.$inferSelect)["capabilities"];
  avatarUrl: string | null;
  mustResetPassword: boolean;
  /** Horodatage d'invalidation en SECONDES, arrondi à l'INFÉRIEUR, pour être
   *  comparable à `token.iat` que NextAuth exprime en secondes. */
  tokenInvalidatedAt: number | null;
  /** Le même horodatage en MILLISECONDES, sans perte de précision. */
  tokenInvalidatedAtMs: number | null;
}

/**
 * Mémoïsation très courte de l'état serveur de l'utilisateur.
 *
 * Le rappel `jwt` est joué à chaque appel de `auth()`, donc à chaque requête
 * authentifiée (parfois plusieurs fois par rendu). Sans cache, la relecture
 * ajouterait un `SELECT` par clé primaire à chacun de ces appels. La fenêtre
 * par défaut de 5 secondes ramène ce coût à au plus une lecture toutes les
 * 5 secondes et par utilisateur, tout en laissant la révocation prendre effet
 * en 5 secondes au pire, contre 24 heures aujourd'hui. Le canal WebSocket et
 * toute nouvelle connexion restent, eux, immédiats. Le cache est par processus :
 * en multi-répliques la borne reste 5 secondes, chaque réplique ayant la sienne.
 *
 * `AUTH_SESSION_CACHE_TTL_MS=0` désactive la mémoïsation (utilisé par les tests).
 */
const userStateCache = new Map<string, { expiresAt: number; state: AuthUserState | null }>();
const USER_STATE_CACHE_MAX = 10_000;

/** Purge l'état mémoïsé d'un compte (ou de tous) : appelée après toute révocation. */
export function clearAuthUserStateCache(userId?: string): void {
  if (userId) userStateCache.delete(userId);
  else userStateCache.clear();
}

function userStateCacheTtlMs(): number {
  const raw = process.env.AUTH_SESSION_CACHE_TTL_MS;
  if (raw === undefined) return 5_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5_000;
}

function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Horodatage d'invalidation en secondes, arrondi à l'INFÉRIEUR.
 *
 * L'arrondi au supérieur, retenu d'abord au nom du principe de prudence,
 * ouvrait une fenêtre d'environ une seconde APRÈS une réinitialisation pendant
 * laquelle un jeton fraîchement émis était jugé antérieur à l'invalidation et
 * détruit au premier rafraîchissement : l'utilisateur qui vient de changer son
 * mot de passe se voyait déconnecté aussitôt reconnecté.
 *
 * L'arrondi à l'inférieur supprime cette fenêtre, mais il n'est pas gratuit :
 * la seconde est la granularité de `iat`, et à granularité égale un jeton émis
 * dans la même seconde que l'invalidation, juste AVANT elle, survivrait. Les
 * deux arrondis échangent donc une fenêtre d'une seconde contre l'autre. La
 * comparaison principale se fait pour cette raison en MILLISECONDES quand le
 * jeton porte `iatMs` (cf. `jwtCallback`), ce qui ne laisse ni l'une ni
 * l'autre ; cette valeur en secondes ne sert plus que de repli pour les jetons
 * émis avant l'introduction de `iatMs`.
 */
function toEpochSeconds(value: Date | string | number | null | undefined): number | null {
  const ms = toEpochMs(value);
  return ms === null ? null : Math.floor(ms / 1000);
}

export async function readAuthUserState(userId: string): Promise<AuthUserState | null> {
  const ttl = userStateCacheTtlMs();
  const now = Date.now();

  if (ttl > 0) {
    const cached = userStateCache.get(userId);
    if (cached && cached.expiresAt > now) return cached.state;
  }

  const [dbUser] = await db
    .select({
      globalRole: users.globalRole,
      capabilities: users.capabilities,
      avatarUrl: users.avatarUrl,
      mustResetPassword: users.mustResetPassword,
      tokenInvalidatedAt: users.tokenInvalidatedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const state: AuthUserState | null = dbUser
    ? {
        globalRole: dbUser.globalRole,
        capabilities: dbUser.capabilities ?? [],
        avatarUrl: dbUser.avatarUrl ?? null,
        mustResetPassword: dbUser.mustResetPassword ?? false,
        tokenInvalidatedAt: toEpochSeconds(dbUser.tokenInvalidatedAt),
        tokenInvalidatedAtMs: toEpochMs(dbUser.tokenInvalidatedAt),
      }
    : null;

  if (ttl > 0) {
    if (userStateCache.size >= USER_STATE_CACHE_MAX) userStateCache.clear();
    userStateCache.set(userId, { expiresAt: now + ttl, state });
  }

  return state;
}

/**
 * Rappel `jwt`.
 *
 * À l'émission (`user` présent) le jeton est hydraté depuis la base comme
 * avant. À chaque rafraîchissement, l'état serveur est relu :
 *  - AZ-05 : `tokenInvalidatedAt` était testé mais jamais lu, donc toujours
 *    absent du jeton, donc la révocation était inopérante ;
 *  - AZ-38 : le rôle global et les capacités étaient figés pour 24 heures,
 *    ce qui repoussait d'autant l'effet d'une rétrogradation. Le rôle global
 *    décidant désormais du franchissement d'organisation (ADR-079), il doit
 *    suivre la base.
 * La vérification de révocation n'est appliquée qu'au rafraîchissement : un
 * jeton qui vient d'être émis ne peut pas être antérieur à l'invalidation.
 */
export async function jwtCallback({
  token,
  user,
}: {
  token: Record<string, unknown>;
  user?: { id?: string } | null;
}): Promise<Record<string, unknown> | null> {
  if (user) {
    const [dbUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id!))
      .limit(1);

    if (dbUser) {
      token.id = dbUser.id;
      token.globalRole = dbUser.globalRole;
      token.capabilities = dbUser.capabilities ?? [];
      token.avatarUrl = dbUser.avatarUrl;
      token.mustResetPassword = dbUser.mustResetPassword ?? false;
      token.tokenInvalidatedAt = toEpochSeconds(dbUser.tokenInvalidatedAt) ?? undefined;
      token.tokenInvalidatedAtMs = toEpochMs(dbUser.tokenInvalidatedAt) ?? undefined;
      // Instant d'émission à la milliseconde : `iat` est en secondes, sa
      // granularité rendait indécidable l'ordre entre une émission et une
      // invalidation survenues dans la même seconde.
      token.iatMs = Date.now();

      const [membership] = await db
        .select({ slug: organizations.slug })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, dbUser.id))
        .limit(1);
      if (membership) token.orgSlug = membership.slug;
    }

    return token;
  }

  if (typeof token.id === "string") {
    const state = await readAuthUserState(token.id);
    // Utilisateur supprimé entre-temps : plus de session.
    if (!state) return null;

    token.globalRole = state.globalRole;
    token.capabilities = state.capabilities;
    token.avatarUrl = state.avatarUrl;
    token.mustResetPassword = state.mustResetPassword;
    token.tokenInvalidatedAt = state.tokenInvalidatedAt ?? undefined;
    token.tokenInvalidatedAtMs = state.tokenInvalidatedAtMs ?? undefined;
  }

  // Invalider si le jeton a été émis avant une révocation côté serveur.
  // À la milliseconde quand le jeton porte son instant d'émission, sinon en
  // secondes pour les jetons émis avant l'introduction de `iatMs`.
  if (typeof token.tokenInvalidatedAtMs === "number" && typeof token.iatMs === "number") {
    if (token.tokenInvalidatedAtMs > token.iatMs) return null;
  } else if (token.tokenInvalidatedAt && token.iat) {
    if ((token.tokenInvalidatedAt as number) > (token.iat as number)) {
      return null;
    }
  }

  return token;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 24 * 60 * 60, // 24 heures
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        domain: process.env.NEXTAUTH_COOKIE_DOMAIN ?? undefined,
      },
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      authorize: (credentials, request) => authorizeCredentials(credentials, request),
    }),
  ],
  callbacks: {
    jwt: (params) =>
      jwtCallback(
        params as unknown as { token: Record<string, unknown>; user?: { id?: string } | null }
      ) as never,
    async session({ session, token }) {
      if (token && session.user) {
        const user = session.user as unknown as SessionUser;
        user.id = token.id as string;
        user.globalRole = token.globalRole as SessionUser["globalRole"];
        user.capabilities = (token.capabilities as SessionUser["capabilities"]) ?? [];
        user.avatarUrl = token.avatarUrl as string | null;
        user.mustResetPassword = token.mustResetPassword as boolean | undefined;
      }
      return session;
    },
  },
});
