/**
 * Rate limiter with in-memory backend (single instance) and optional Redis backend.
 * Set REDIS_URL in env to enable Redis backend for multi-instance deployments.
 */

import { createHash } from "crypto";

import logger from "@/lib/logger";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  /** Maximum number of requests in the window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

// ─── Backend interface ──────────────────────────────────────────────────────

interface RateLimitBackend {
  check(key: string, config: RateLimitConfig): Promise<RateLimitResult> | RateLimitResult;
  /**
   * Dit si la clé est DÉJÀ au-dessus du plafond, SANS rien consommer.
   *
   * Indispensable pour un compteur qui ne doit compter que les échecs : le
   * chemin chaud doit pouvoir refuser avant tout travail coûteux, puis décider
   * seulement après la vérification s'il consomme un jeton ou non.
   */
  peek(key: string, config: RateLimitConfig): Promise<boolean> | boolean;
  /** Efface le compteur d'une clé (remise à zéro sur succès). */
  reset(key: string): Promise<void> | void;
}

// ─── In-memory backend ──────────────────────────────────────────────────────

const memoryStore = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.resetAt <= now) memoryStore.delete(key);
  }
}, 5 * 60 * 1000).unref();

const memoryBackend: RateLimitBackend = {
  check(key: string, config: RateLimitConfig): RateLimitResult {
    const now = Date.now();
    const entry = memoryStore.get(key);

    if (!entry || entry.resetAt <= now) {
      memoryStore.set(key, { count: 1, resetAt: now + config.windowMs });
      return { success: true, remaining: config.maxRequests - 1, resetAt: now + config.windowMs };
    }

    if (entry.count >= config.maxRequests) {
      return { success: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { success: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
  },

  peek(key: string, config: RateLimitConfig): boolean {
    const entry = memoryStore.get(key);
    if (!entry || entry.resetAt <= Date.now()) return false;
    return entry.count >= config.maxRequests;
  },

  reset(key: string): void {
    memoryStore.delete(key);
  },
};

// ─── Redis backend (lazy-initialized) ───────────────────────────────────────

let redisBackend: RateLimitBackend | null = null;
/**
 * Instant (epoch ms) avant lequel il est inutile de retenter l'initialisation
 * de Redis. Remplace l'ancien drapeau booléen « tentative faite », qui
 * verrouillait le repli mémoire DÉFINITIVEMENT : une coupure de quelques
 * secondes au démarrage suffisait à priver le processus du compteur partagé
 * pour toute sa durée de vie (AZ-26). On retente donc, mais pas à chaque
 * requête : une fenêtre de refroidissement évite de payer un aller-retour de
 * connexion sur le chemin chaud quand Redis est durablement absent.
 */
let redisRetryAfter = 0;
/** Connexion en cours, partagée pour ne pas ouvrir N sockets en parallèle. */
let redisInitInFlight: Promise<RateLimitBackend | null> | null = null;

const REDIS_RETRY_COOLDOWN_MS = 30 * 1000;

/** Écarte le client courant et programme une nouvelle tentative. */
function scheduleRedisRetry(): void {
  redisBackend = null;
  redisInitInFlight = null;
  redisRetryAfter = Date.now() + REDIS_RETRY_COOLDOWN_MS;
}

async function connectRedis(redisUrl: string): Promise<RateLimitBackend | null> {
  try {
    // Dynamic import to avoid bundling ioredis when not used
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();

    // ioredis reconnecte tout seul APRÈS une connexion réussie ; sans ce
    // gestionnaire, l'événement d'erreur non écouté remonterait en exception
    // non capturée et tuerait le processus.
    redis.on("error", (err: unknown) => {
      logger.warn({ err }, "[rate-limit] Erreur du client Redis");
    });

    redisBackend = {
      async check(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
        const now = Date.now();
        const windowKey = `rl:${key}`;

        const multi = redis.multi();
        multi.incr(windowKey);
        multi.pttl(windowKey);
        const results = await multi.exec();

        const count = (results?.[0]?.[1] as number) ?? 1;
        const ttl = (results?.[1]?.[1] as number) ?? -1;

        // Set expiry on first request in window
        if (count === 1 || ttl === -1) {
          await redis.pexpire(windowKey, config.windowMs);
        }

        const resetAt = ttl > 0 ? now + ttl : now + config.windowMs;
        const remaining = Math.max(0, config.maxRequests - count);

        return {
          success: count <= config.maxRequests,
          remaining,
          resetAt,
        };
      },

      async peek(key: string, config: RateLimitConfig): Promise<boolean> {
        const raw = await redis.get(`rl:${key}`);
        if (raw === null || raw === undefined) return false;
        const count = Number(raw);
        return Number.isFinite(count) && count >= config.maxRequests;
      },

      async reset(key: string): Promise<void> {
        await redis.del(`rl:${key}`);
      },
    };

    logger.info("[rate-limit] Redis backend initialized");
    return redisBackend;
  } catch (err) {
    logger.warn({ err }, "[rate-limit] Redis unavailable, using in-memory backend");
    scheduleRedisRetry();
    return null;
  }
}

async function getRedisBackend(): Promise<RateLimitBackend | null> {
  if (redisBackend) return redisBackend;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  if (Date.now() < redisRetryAfter) return null;
  if (redisInitInFlight) return redisInitInFlight;

  redisInitInFlight = connectRedis(redisUrl).finally(() => {
    redisInitInFlight = null;
  });
  return redisInitInFlight;
}

/** Réinitialise l'état de connexion. Réservé aux tests. */
export function __resetRateLimitBackendForTests(): void {
  redisBackend = null;
  redisInitInFlight = null;
  redisRetryAfter = 0;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Vérifie un quota, adossement mémoire UNIQUEMENT.
 *
 * @deprecated Sur un déploiement à plusieurs répliques, ce compteur vit dans le
 * processus : le quota réel vaut la valeur configurée MULTIPLIÉE par le nombre
 * d'instances, et tout redémarrage le remet à zéro (AZ-26). Réservé aux usages
 * strictement locaux et aux tests. Tout chemin sensible (authentification,
 * inscription, appels d'IA facturés, points d'entrée non authentifiés) doit
 * utiliser `checkRateLimitAsync`, qui s'adosse à Redis quand `REDIS_URL` est
 * défini.
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  return memoryBackend.check(identifier, config) as RateLimitResult;
}

/**
 * Vérifie un quota sur le compteur PARTAGÉ quand `REDIS_URL` est défini,
 * sur le compteur mémoire sinon. Variante à utiliser par défaut.
 *
 * Une panne du compteur partagé ne doit pas rendre la route indisponible :
 * l'erreur est absorbée, le repli mémoire prend le relais, et une nouvelle
 * tentative de connexion est programmée.
 */
export async function checkRateLimitAsync(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const backend = await getRedisBackend();
  if (backend) {
    try {
      return await backend.check(identifier, config);
    } catch (err) {
      logger.warn({ err }, "[rate-limit] Échec du compteur partagé, repli mémoire");
      scheduleRedisRetry();
    }
  }
  return memoryBackend.check(identifier, config);
}

/**
 * Applique une pile de paliers de durées croissantes sur une même clé.
 *
 * Empiler les fenêtres donne un verrouillage progressif : plus l'appelant
 * insiste, plus la porte reste fermée longtemps. Tous les paliers sont
 * consommés à chaque appel, y compris quand un palier plus court a déjà
 * refusé, pour que l'insistance nourrisse bien les fenêtres longues.
 *
 * Rend `true` quand AU MOINS un palier refuse.
 */
export async function isQuotaExceeded(
  key: string,
  tiers: readonly RateLimitConfig[]
): Promise<boolean> {
  let exceeded = false;
  for (const [index, tier] of tiers.entries()) {
    const result = await checkRateLimitAsync(tierKey(key, index), tier);
    if (!result.success) exceeded = true;
  }
  return exceeded;
}

/**
 * Clé d'un palier. Une seule construction pour tout le monde : c'est la
 * condition pour que `peek`, `consume` et `reset` visent bien le même seau.
 */
function tierKey(key: string, index: number): string {
  return `${key}:t${index}`;
}

/**
 * Dit si une pile de paliers refuse DÉJÀ, SANS consommer aucun jeton.
 *
 * C'est la moitié « lecture » d'un compteur d'échecs : le chemin chaud
 * interroge d'abord, refuse tout de suite si la porte est fermée (donc avant
 * toute lecture en base et avant tout calcul de mot de passe), et ne consomme
 * qu'ensuite, et seulement si la vérification a échoué.
 */
export async function peekQuotaExceeded(
  key: string,
  tiers: readonly RateLimitConfig[]
): Promise<boolean> {
  for (const [index, tier] of tiers.entries()) {
    const backend = await getRedisBackend();
    if (backend) {
      try {
        if (await backend.peek(tierKey(key, index), tier)) return true;
        continue;
      } catch (err) {
        logger.warn({ err }, "[rate-limit] Échec de lecture du compteur partagé, repli mémoire");
        scheduleRedisRetry();
      }
    }
    if (memoryBackend.peek(tierKey(key, index), tier)) return true;
  }
  return false;
}

/**
 * Consomme un jeton sur chaque palier de la pile.
 *
 * Tous les paliers sont consommés à chaque appel, y compris quand un palier
 * plus court a déjà atteint son plafond, pour que l'insistance nourrisse bien
 * les fenêtres longues et donne le verrouillage progressif.
 */
export async function consumeQuota(
  key: string,
  tiers: readonly RateLimitConfig[]
): Promise<void> {
  for (const [index, tier] of tiers.entries()) {
    await checkRateLimitAsync(tierKey(key, index), tier);
  }
}

/** Remet à zéro tous les paliers d'une pile (typiquement sur un succès). */
export async function resetQuota(
  key: string,
  tiers: readonly RateLimitConfig[]
): Promise<void> {
  for (let index = 0; index < tiers.length; index++) {
    const backend = await getRedisBackend();
    if (backend) {
      try {
        await backend.reset(tierKey(key, index));
        continue;
      } catch (err) {
        logger.warn({ err }, "[rate-limit] Échec de remise à zéro du compteur partagé");
        scheduleRedisRetry();
      }
    }
    memoryBackend.reset(tierKey(key, index));
  }
}

/** Rate limit presets */
export const RATE_LIMITS = {
  /** Login/Register: 10 attempts per 15 minutes */
  auth: { maxRequests: 10, windowMs: 15 * 60 * 1000 },
  /** Search: 60 requests per minute */
  search: { maxRequests: 60, windowMs: 60 * 1000 },
  /** AI chat: 20 requests per minute */
  ai: { maxRequests: 20, windowMs: 60 * 1000 },
  /** AI embed: 30 requests per minute (coût API élevé) */
  embed: { maxRequests: 30, windowMs: 60 * 1000 },
  /** Link preview: 30 requests per minute */
  linkPreview: { maxRequests: 30, windowMs: 60 * 1000 },
  /** Routing (OSRM): 30 requests per minute */
  routing: { maxRequests: 30, windowMs: 60 * 1000 },
  /** Import distant dans la médiathèque: 20 requests per minute par utilisateur */
  mediaImport: { maxRequests: 20, windowMs: 60 * 1000 },
  /** Téléversement par l'API v1 médias: 10 requests per minute par clé */
  mediaUploadApi: { maxRequests: 10, windowMs: 60 * 1000 },
  /** Téléchargement groupé en zip : 3 archives par 10 minutes et par utilisateur */
  mediaZip: { maxRequests: 3, windowMs: 10 * 60 * 1000 },
  /** Sondes de téléchargement groupé (probe=1) : 20 par minute et par utilisateur */
  mediaZipProbe: { maxRequests: 20, windowMs: 60 * 1000 },
  /** Réindexation IA d'un média : 10 par minute et par utilisateur */
  mediaReindex: { maxRequests: 10, windowMs: 60 * 1000 },
  /** Enregistrement d'une retouche d'image : 20 par minute et par utilisateur */
  mediaRetouch: { maxRequests: 20, windowMs: 60 * 1000 },
  /** Ouverture d'un envoi multipart médiathèque : 10 par heure et par utilisateur */
  mediaMultipartOpen: { maxRequests: 10, windowMs: 60 * 60 * 1000 },
  /** Signature de parts multipart : 120 appels (20 parts chacun) par minute et par utilisateur */
  mediaMultipartSign: { maxRequests: 120, windowMs: 60 * 1000 },
  /** Meet: 20 requests per minute */
  meet: { maxRequests: 20, windowMs: 60 * 1000 },
} as const;

// ─── Freins de bruteforce partagés (connexion, CalDAV) ──────────────────────

/**
 * Paliers serrés, indexés sur le COUPLE compte + adresse cliente.
 *
 * Ces paliers ne comptent QUE les échecs d'authentification, et sont remis à
 * zéro par un succès. Deux raisons de les indexer sur le couple et non sur le
 * seul compte :
 *  - un verrouillage par compte seul offre à n'importe quel tiers un déni de
 *    service ciblé : quelques dizaines de requêtes portant l'adresse de la
 *    victime, avec un mot de passe quelconque, lui ferment la porte, et elle
 *    n'y peut rien puisque le refus est indistinguable d'un mot de passe faux ;
 *  - un verrouillage par adresse seule, lui, ne protège pas d'un attaquant
 *    distribué.
 * Le couple garde le frein serré là où l'attaquant se trouve, tout en laissant
 * intact le seau de la victime, qui se connecte depuis une autre adresse.
 */
export const AUTH_FAILURE_TIERS = [
  { maxRequests: 5, windowMs: 60 * 1000 },
  { maxRequests: 10, windowMs: 15 * 60 * 1000 },
  { maxRequests: 20, windowMs: 60 * 60 * 1000 },
] as const;

/**
 * Palier de secours indexé sur le COMPTE seul, volontairement très large.
 *
 * Il rattrape le bourrage d'identifiants distribué, que les paliers par couple
 * laisseraient passer puisque chaque adresse attaquante y a son propre seau.
 * Large à dessein : c'est ce qui rend le déni de service ciblé coûteux (il faut
 * cent échecs par heure, depuis autant d'adresses qu'on veut, pour fermer une
 * heure) là où un plafond serré par compte le rendait gratuit. Lui aussi ne
 * compte que les échecs et est remis à zéro par un succès.
 */
export const AUTH_ACCOUNT_TIERS = [
  { maxRequests: 100, windowMs: 60 * 60 * 1000 },
] as const;

/**
 * Paliers par adresse cliente seule, plus larges : une adresse peut
 * légitimement porter tout un bureau derrière un NAT. Ils rattrapent le
 * balayage d'un attaquant qui change de compte à chaque tentative, cas où ni le
 * seau par couple ni le seau par compte ne s'accumulent.
 */
export const AUTH_IP_TIERS = [
  { maxRequests: 20, windowMs: 60 * 1000 },
  { maxRequests: 60, windowMs: 15 * 60 * 1000 },
  { maxRequests: 120, windowMs: 60 * 60 * 1000 },
] as const;

/**
 * Empreinte courte d'un identifiant (adresse électronique, jeton) destinée à
 * servir de composant de clé : évite de semer des adresses en clair dans le
 * compteur partagé et dans les journaux.
 */
export function authIdentityBucket(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/**
 * Composant de clé représentant l'adresse cliente, `null` compris.
 *
 * `null` (adresse indéterminable) devient un seau explicitement distinct de
 * celui des clients identifiés, jamais la constante `UNKNOWN_CLIENT_IP`
 * indexée comme si c'était une adresse (AZ-25).
 */
export function ipKeyPart(ip: string | null): string {
  return ip ? `ip:${ip}` : "noip";
}

/**
 * Number of trusted reverse proxies in front of the app.
 * In a typical setup (nginx → app), this is 1.
 * The rightmost IP in x-forwarded-for added by the trusted proxy is used.
 */
const TRUSTED_PROXY_COUNT = parseInt(process.env.TRUSTED_PROXY_COUNT || "1", 10);

/**
 * Valeur rendue par `getClientIp` quand aucune adresse n'a pu être déterminée.
 *
 * Ce n'est PAS une adresse : c'est une constante, identique pour tout le monde.
 * L'indexer comme une adresse dans une clé de quota met tous les clients
 * anonymes dans le MÊME seau, ce qui transforme la limitation en déni de
 * service partagé (AZ-25) : quelques requêtes suffisent alors à fermer la porte
 * à tous. Un appelant qui construit une clé de quota doit donc passer par
 * `getClientIpOrNull` et traiter `null` comme une ABSENCE d'adresse, jamais
 * comme une adresse : soit en sautant le palier par IP au profit d'une autre
 * dimension (compte, adresse électronique, jeton), soit en utilisant un seau
 * explicitement distinct de celui des clients identifiés.
 *
 * L'usage légitime de la constante est la journalisation d'audit, où « adresse
 * inconnue » est une information à écrire telle quelle.
 */
export const UNKNOWN_CLIENT_IP = "unknown";

/**
 * Adresse IP du client, ou la constante `UNKNOWN_CLIENT_IP` si aucune n'est
 * déterminable.
 *
 * Prend l'adresse la plus à DROITE moins le nombre de proxys de confiance :
 * seules les valeurs ajoutées par l'infrastructure sont dignes de foi, tout ce
 * que le client a mis à gauche dans `x-forwarded-for` est de sa fabrication.
 *
 * Destinée à la journalisation. Pour une clé de quota, voir
 * `getClientIpOrNull` et la note de `UNKNOWN_CLIENT_IP`.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim());
    // The last N IPs are added by trusted proxies; the client IP is right before them
    const clientIndex = Math.max(0, ips.length - TRUSTED_PROXY_COUNT);
    return ips[clientIndex] || UNKNOWN_CLIENT_IP;
  }
  return UNKNOWN_CLIENT_IP;
}

/**
 * Même extraction que `getClientIp`, mais rend `null` plutôt qu'une constante
 * quand l'adresse est indéterminable. Variante à utiliser pour construire une
 * clé de quota (cf. `UNKNOWN_CLIENT_IP`).
 */
export function getClientIpOrNull(request: Request): string | null {
  const ip = getClientIp(request);
  return ip === UNKNOWN_CLIENT_IP ? null : ip;
}
