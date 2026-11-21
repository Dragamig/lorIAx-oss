import { createHash } from "node:crypto";
import logger from "@/lib/logger";
import { logAIUsage } from "@/lib/ai/usage-logger";
import {
  resolveRerankProviderInOrg,
  type ProviderOrgScope,
  type ResolvedRerankProvider,
} from "@/lib/ai/provider-resolver";
import { isRerankEnabledFor, type RerankSurface } from "@/lib/ai/rerank-settings";

/** Facteur de sur-echantillonnage avant reclassement. */
export const RERANK_OVERSAMPLE = 4;
/**
 * Plafond de candidats envoyes au fournisseur.
 *
 * Trois bornes gouvernent le meme flux, chacune dans son fichier : ce
 * plafond et `RERANK_OVERSAMPLE` ici, la fenetre minimale de fusion
 * `MIN_RERANK_CANDIDATE_WINDOW` dans `rerank-window.ts`, et la limite de
 * resultats acceptee par la route de recherche. Elles s'articulent ainsi :
 * la route fusionne jusqu'a sa propre limite, `rerankWindowSize` elargit
 * cette fusion a au moins `MIN_RERANK_CANDIDATE_WINDOW` candidats, puis ce
 * module ne retient que les `RERANK_MAX_CANDIDATES` premiers pour l'appel au
 * fournisseur. Au-dela de ce plafond, le devenir des elements differe selon
 * le chemin : en recherche generale, `completeWithFusionTail` les complete
 * en queue dans l'ordre de la fusion ; en recherche semantique (KB, chat
 * documents), ils sont simplement absents du resultat reclasse, non
 * reclasses.
 */
export const RERANK_MAX_CANDIDATES = 40;
/** Troncature d'un candidat, en caracteres. */
const MAX_CHARS_PER_DOC = 2000;
/** Temps maximal d'un appel, en millisecondes. */
const TIMEOUT_MS = 3000;
/** Duree de vie d'une entree de cache, en millisecondes. */
const CACHE_TTL_MS = 60_000;
/** Nombre maximal d'entrees de cache. */
const CACHE_MAX_ENTRIES = 200;
/** Longueur minimale d'une requete pour valoir un appel. */
const MIN_QUERY_LENGTH = 3;

/** Nombre de lignes a demander en amont pour un top-N donne. */
export function oversampleLimit(limit: number): number {
  return Math.min(Math.max(limit, 1) * RERANK_OVERSAMPLE, RERANK_MAX_CANDIDATES);
}

/**
 * Nombre de lignes a demander en SQL pour un reclassement de `limit` resultats.
 *
 * `oversampleLimit` plafonne a `RERANK_MAX_CANDIDATES` (40) : au-dela, il rend
 * une valeur INFERIEURE a `limit`. Utiliser ce plafond seul comme LIMIT SQL
 * ferait perdre silencieusement des resultats des que l'appelant demande plus
 * de 40 lignes. On prend donc le maximum entre la limite demandee et la
 * limite sur-echantillonnee.
 */
export function fetchLimitForRerank(limit: number): number {
  return Math.max(limit, oversampleLimit(limit));
}

interface RerankHit {
  index: number;
  score: number;
}

/**
 * Lit la reponse du fournisseur (forme Cohere Rerank v2). Tolerante : toute
 * forme inattendue rend un tableau vide, ce qui fait conserver l'ordre
 * d'entree a l'appelant. Les index hors bornes, les index dupliques (seule la
 * premiere occurrence est gardee) et les scores non finis (NaN, Infinity)
 * sont ecartes plutot que de rendre le tri arbitraire.
 */
export function parseRerankResponse(
  raw: unknown,
  candidateCount: number
): RerankHit[] {
  if (!raw || typeof raw !== "object") return [];
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const hits: RerankHit[] = [];
  const seen = new Set<number>();
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const index = (item as { index?: unknown }).index;
    const score = (item as { relevance_score?: unknown }).relevance_score;
    if (typeof index !== "number" || !Number.isInteger(index)) continue;
    if (index < 0 || index >= candidateCount) continue;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    hits.push({ index, score });
  }
  return hits;
}

interface CacheEntry {
  expiresAt: number;
  order: number[];
}

const cache = new Map<string, CacheEntry>();

/** Vide le cache (tests, et changement de configuration). */
export function clearRerankCache(): void {
  cache.clear();
}

/**
 * Ajoute un segment prefixe par sa longueur en octets UTF-8, a la maniere
 * d'un netstring. Un simple joint par espace est ambigu : deux combinaisons
 * differentes de requete/documents peuvent produire la meme chaine (ex.
 * requete "aaa" + documents ["bbb ccc", "ddd"] contre requete "aaa bbb" +
 * documents ["ccc", "ddd"]). Le prefixe de longueur leve cette ambiguite.
 */
function pushSegment(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.byteLength(value, "utf8");
  hash.update(String(bytes));
  hash.update(":");
  hash.update(value, "utf8");
}

function cacheKey(
  query: string,
  providerId: string,
  baseUrl: string,
  model: string,
  texts: string[]
): string {
  const hash = createHash("sha256");
  pushSegment(hash, providerId);
  pushSegment(hash, baseUrl);
  pushSegment(hash, model);
  pushSegment(hash, query.trim().toLowerCase());
  pushSegment(hash, String(texts.length));
  for (const text of texts) {
    pushSegment(hash, text);
  }
  return hash.digest("hex");
}

function readCache(key: string): number[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.order;
}

function writeCache(key: string, order: number[]): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, order });
}

export interface RerankOptions<T> {
  /** Extrait le texte a comparer a la requete. */
  getText: (item: T) => string;
  /** Nombre de resultats a conserver. */
  topN: number;
  /** Surface appelante, pour la lecture des interrupteurs. */
  surface: RerankSurface;
  /** Utilisateur, pour le journal d'usage. */
  userId?: string;
  /**
   * Portee d'organisation de la selection du fournisseur (cloisonnement
   * AZ-06, lot 6). Le reclassement envoie des extraits de documents a un point
   * de terminaison externe : ce point ne doit jamais etre celui d'un tenant
   * voisin. `null` limite la selection aux fournisseurs de portee instance.
   *
   * Champ OBLIGATOIRE et jamais `undefined` : un appelant qui n'a pas
   * d'organisation doit passer une portee explicite (`null`, ou
   * `await instanceProviderScope()` pour une ressource d'instance), il ne peut
   * plus l'omettre par distraction.
   * C'est la lecon du lot 6, « un parametre de securite optionnel est un
   * parametre oublie » (ADR-079) : la route de recherche connaissait son
   * organisation et ne la passait pas, ce qui lui faisait perdre le
   * reclassement en multi-tenant, en silence.
   *
   * Le repli sans organisation reste {@link instanceProviderScope} (cf.
   * `@/lib/ai/org-scope`), mais c'est a l'appelant de le demander.
   */
  organizationId: ProviderOrgScope;
}

/**
 * Journalise l'usage du reclassement dans son propre bloc protege : un jet
 * (synchrone ou non) ne doit jamais remonter jusqu'a l'appelant de
 * `rerankCandidates`, ni faire perdre l'ordre deja calcule et deja mis en
 * cache. Volontairement hors du chemin de retour principal.
 */
function logRerankUsage(params: {
  userId: string | undefined;
  provider: ResolvedRerankProvider;
  payload: unknown;
  startedAt: number;
}): void {
  const { userId, provider, payload, startedAt } = params;
  if (!userId) return;
  try {
    const totalTokens =
      typeof (payload as { usage?: { total_tokens?: unknown } })?.usage
        ?.total_tokens === "number"
        ? (payload as { usage: { total_tokens: number } }).usage.total_tokens
        : 0;

    logAIUsage({
      userId,
      usageType: "rerank",
      providerId: provider.providerId,
      model: provider.model,
      tokensIn: totalTokens,
      tokensOut: 0,
      latencyMs: Date.now() - startedAt,
      status: "success",
    });
  } catch (err) {
    logger.warn(
      { err },
      "Echec de la journalisation d'usage du reclassement, resultat conserve"
    );
  }
}

/**
 * Reclasse une liste de candidats par pertinence vis-a-vis d'une requete.
 *
 * Ne leve jamais : interrupteur eteint, fournisseur absent, `getText` qui
 * leve, HTTP en erreur, temps depasse ou reponse illisible rendent la liste
 * d'entree tronquee a `topN`, dans son ordre d'origine. Le reclassement ne
 * peut donc pas degrader une recherche, au pire il ne l'ameliore pas.
 */
export async function rerankCandidates<T>(
  query: string,
  items: T[],
  options: RerankOptions<T>
): Promise<T[]> {
  const { getText, topN, surface, userId } = options;
  const fallback = () => items.slice(0, topN);

  if (items.length < 2) return fallback();
  if (query.trim().length < MIN_QUERY_LENGTH) return fallback();

  if (!(await isRerankEnabledFor(surface))) return fallback();

  const provider = await resolveRerankProviderInOrg(options.organizationId);
  if (!provider) return fallback();

  const candidates = items.slice(0, RERANK_MAX_CANDIDATES);

  // Tout ce qui peut lever (extraction de texte comprise) reste dans ce bloc
  // protege : aucune exception ne doit jamais atteindre l'appelant.
  try {
    const texts = candidates.map((item) =>
      (getText(item) || "").slice(0, MAX_CHARS_PER_DOC)
    );

    const key = cacheKey(query, provider.providerId, provider.baseUrl, provider.model, texts);
    const cached = readCache(key);
    if (cached) {
      return cached.slice(0, topN).map((index) => candidates[index]);
    }

    const started = Date.now();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;

    const response = await fetch(`${provider.baseUrl}/rerank`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: provider.model,
        query,
        documents: texts,
        // Classement complet demande : le cache stocke l'ordre entier, la
        // troncature a `topN` se fait cote application (voir plus bas). Sans
        // cela, un premier appel a topN=2 puis un second a topN=4 sur la
        // meme requete ne rendrait que 2 resultats en cache.
        top_n: texts.length,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, providerId: provider.providerId },
        "Reclassement refuse par le fournisseur, ordre d'origine conserve"
      );
      return fallback();
    }

    const payload = await response.json();
    const hits = parseRerankResponse(payload, candidates.length);
    if (hits.length === 0) return fallback();

    hits.sort((a, b) => b.score - a.score);
    const rankedIndices = hits.map((hit) => hit.index);
    // Une passerelle qui plafonne de son cote peut rendre moins d'entrees
    // qu'elle n'a recu de candidats : sans completer, la liste rendue serait
    // plus courte que `topN` demande, en silence. On complete donc l'ordre
    // recu avec les index absents, dans leur ordre d'entree, avant de
    // tronquer plus bas.
    const seenIndices = new Set(rankedIndices);
    const order = rankedIndices.slice();
    for (let i = 0; i < candidates.length; i++) {
      if (!seenIndices.has(i)) order.push(i);
    }
    writeCache(key, order);

    // Journalisation isolee : un echec ici ne doit jamais faire retomber sur
    // l'ordre d'origine alors que le reclassement a reussi.
    logRerankUsage({ userId, provider, payload, startedAt: started });

    return order.slice(0, topN).map((index) => candidates[index]);
  } catch (err) {
    logger.warn({ err }, "Reclassement indisponible, ordre d'origine conserve");
    return fallback();
  }
}
