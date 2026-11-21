// Pas de `import "server-only"` ici, volontairement. Ce module est aussi chargé
// par le serveur Node personnalisé (`server.ts`), qui exécute le planificateur
// d'automatismes hors du bundle Next : le paquet `server-only` y lève à
// l'importation, faute de la condition `react-server`. La protection réelle
// contre les requêtes sortantes détournées est portée par `validateExternalUrl`
// et `assertPublicHostname`, pas par ce marqueur de bundling.

import { Agent } from "undici";
import { validateExternalUrl, isPrivateUrl } from "@/lib/security/url-validator";
import { resolvePublicAddresses } from "@/lib/security/url-validator-server";

/**
 * Point de passage unique des requêtes sortantes vers une cible que
 * l'utilisateur influence, en tout ou partie.
 *
 * Deux niveaux, du plus fermé au plus ouvert :
 *
 * - `fetchAllowlistedHost` : la cible doit appartenir à une liste d'hôtes
 *   connus (API d'un fournisseur tiers). C'est le niveau à préférer dès que
 *   l'ensemble des destinations légitimes est fini, notamment quand un secret
 *   part dans les en-têtes.
 * - `safeExternalFetch` : la cible est une URL publique quelconque fournie par
 *   l'utilisateur (webhook, aperçu de lien, proxy de données). Contrôle de
 *   syntaxe, résolution DNS anti-rebinding, puis suivi manuel des redirections
 *   avec revalidation de chaque saut.
 *
 * Dans les deux cas : délai maximal, refus des protocoles autres que HTTP(S),
 * et borne de taille optionnelle, appliquée sur les octets réellement reçus.
 *
 * Motivation : audit du 2026-08-19, constats P0-1 / INJ-02, INJ-07, INJ-08 et
 * INJ-24. La brique anti-SSRF existait déjà, plusieurs points d'appel la
 * contournaient. Ce module fait de la brique le chemin le plus court.
 */

export type OutboundDenyReason =
  | "invalid-url"
  | "protocol"
  | "host-not-allowed"
  | "private-address"
  | "too-many-redirects"
  | "too-large";

/** Refus d'une requête sortante, avant toute connexion. */
export class OutboundRequestError extends Error {
  constructor(
    public readonly reason: OutboundDenyReason,
    message: string,
  ) {
    super(message);
    this.name = "OutboundRequestError";
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

function parseUrl(rawUrl: string): URL {
  try {
    return new URL(rawUrl);
  } catch {
    throw new OutboundRequestError("invalid-url", "URL invalide");
  }
}

/** Vrai si `hostname` est l'un des hôtes autorisés, ou l'un de leurs sous-domaines. */
function matchesAllowedHost(hostname: string, hosts: readonly string[]): boolean {
  const target = hostname.toLowerCase();
  return hosts.some((host) => {
    const allowed = host.toLowerCase();
    return target === allowed || target.endsWith(`.${allowed}`);
  });
}

export interface AllowlistedFetchOptions {
  /** Hôtes autorisés, sous-domaines compris. Comparaison insensible à la casse. */
  hosts: readonly string[];
  /** Délai maximal de la requête. Défaut : 10 secondes. */
  timeoutMs?: number;
  /** Options passées à `fetch`. `redirect` et `signal` sont imposés. */
  init?: Omit<RequestInit, "redirect" | "signal">;
}

/**
 * Requête sortante vers un hôte d'une liste blanche, en HTTPS uniquement.
 *
 * Les redirections sont refusées (`redirect: "error"`) : un hôte autorisé ne
 * peut pas servir de tremplin vers une cible interne, et un secret placé dans
 * les en-têtes ne suit jamais un saut inattendu.
 */
export async function fetchAllowlistedHost(
  rawUrl: string,
  options: AllowlistedFetchOptions,
): Promise<Response> {
  const url = parseUrl(rawUrl);

  if (url.protocol !== "https:") {
    throw new OutboundRequestError("protocol", "HTTPS obligatoire");
  }
  if (!matchesAllowedHost(url.hostname, options.hosts)) {
    throw new OutboundRequestError("host-not-allowed", "Hôte non autorisé");
  }
  // Défense en profondeur : un hôte de la liste ne devrait jamais être privé,
  // mais la liste peut être élargie un jour sans relire ce fichier.
  if (isPrivateUrl(url)) {
    throw new OutboundRequestError("private-address", "Adresse privée");
  }

  return fetch(url, {
    ...options.init,
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
}

export interface SafeFetchOptions {
  /** Délai maximal de la requête, redirections comprises. Défaut : 10 secondes. */
  timeoutMs?: number;
  /** Nombre de redirections suivies, chacune revalidée. Défaut : 3. Zéro les refuse toutes. */
  maxRedirects?: number;
  /**
   * Refuse la réponse au-delà de cette taille. Le contrôle porte sur les
   * octets réellement lus, pas sur le seul `Content-Length` déclaré.
   */
  maxBytes?: number;
  /**
   * Lève le refus des adresses privées/locales, protocole toujours limité à
   * http(s). Réservé aux appelants qui portent une exception explicite et
   * réfléchie (webhooks sortants d'une instance auto-hébergée) : par défaut
   * `false`, c'est-à-dire le comportement actuel. Ne JAMAIS dériver cette
   * valeur d'une entrée utilisateur : elle doit venir d'une configuration
   * d'instance (variable d'environnement), jamais d'un champ de requête.
   */
  allowPrivateTargets?: boolean;
  /** Options passées à `fetch`. `redirect` et `signal` sont imposés. */
  init?: Omit<RequestInit, "redirect" | "signal">;
}

/**
 * Contrôle complet d'une cible avant connexion : syntaxe, protocole, adresse
 * résolue. `allowPrivateTargets` lève le refus des adresses privées (webhooks
 * d'une instance auto-hébergée, `WEBHOOK_ALLOW_PRIVATE_TARGETS`) sans jamais
 * lever le contrôle de protocole, qui reste http(s) uniquement dans tous les
 * cas.
 */
async function assertReachableTarget(
  url: URL,
  allowPrivateTargets = false,
): Promise<{ address: string; family: number }[]> {
  const syntaxError = validateExternalUrl(url.toString(), { allowPrivateTargets });
  if (syntaxError) {
    throw new OutboundRequestError(
      url.protocol === "http:" || url.protocol === "https:" ? "private-address" : "protocol",
      syntaxError,
    );
  }
  // La résolution DNS anti-rebinding ne sert qu'à confirmer qu'une adresse
  // publique le reste au moment de l'appel : sans intérêt une fois les
  // adresses privées elles-mêmes autorisées.
  if (allowPrivateTargets) return [];
  try {
    return await resolvePublicAddresses(url);
  } catch {
    throw new OutboundRequestError(
      "private-address",
      "L'hôte résout vers une adresse privée ou est injoignable",
    );
  }
}

/**
 * Agent dont la résolution DNS est figée sur les adresses déjà validées : la
 * connexion ne refait aucune résolution, ce qui ferme la fenêtre de DNS
 * rebinding entre le contrôle et la requête. SNI et certificat restent ceux
 * du nom d'hôte d'origine. `undefined` pour un littéral IP (rien à résoudre).
 */
function pinnedDispatcher(addresses: { address: string; family: number }[]): Agent | undefined {
  if (!addresses || addresses.length === 0) return undefined;
  return new Agent({
    keepAliveTimeout: 1_000,
    connect: {
      lookup: (_host, options, callback) => {
        const wantsAll = typeof options === "object" && options !== null && options.all;
        if (wantsAll) {
          (callback as (e: null, a: { address: string; family: number }[]) => void)(null, addresses);
        } else {
          const first = addresses[0];
          (callback as (e: null, a: string, f: number) => void)(null, first.address, first.family);
        }
      },
    },
  });
}

/** En-têtes porteurs d'identité, retirés dès qu'une redirection change d'origine. */
const CREDENTIAL_HEADERS = ["authorization", "cookie", "proxy-authorization"];

/** En-têtes décrivant un corps de requête, retirés quand ce corps disparaît. */
const REQUEST_BODY_HEADERS = [
  "content-encoding",
  "content-language",
  "content-length",
  "content-location",
  "content-type",
];

/**
 * Réplique le traitement d'une redirection par le `fetch` natif, que le suivi
 * manuel (`redirect: "manual"`) court-circuite.
 *
 * Deux règles de la norme, que rejouer les options à l'identique violait :
 *
 * - un changement d'origine retire `Authorization`, `Cookie` et
 *   `Proxy-Authorization`. Sans cela, l'action webhook des automatismes, dont
 *   les en-têtes sont fournis par l'utilisateur et portent typiquement un
 *   jeton, livrait ce jeton en clair au tiers désigné par un hôte légitime ;
 * - une 303, ou une 301/302 sur POST, devient un GET sans corps.
 *
 * `init.headers` peut être un objet simple, un tableau de paires ou un
 * `Headers` : le constructeur `Headers` normalise les trois.
 */
function initForRedirect(
  init: RequestInit | undefined,
  status: number,
  from: URL,
  to: URL,
): RequestInit {
  const next: RequestInit = { ...init };
  const headers = new Headers(init?.headers);

  if (from.origin !== to.origin) {
    for (const name of CREDENTIAL_HEADERS) headers.delete(name);
  }

  const method = (init?.method ?? "GET").toUpperCase();
  const stripsBody =
    (status === 303 && method !== "GET" && method !== "HEAD") ||
    ((status === 301 || status === 302) && method === "POST");

  if (stripsBody) {
    next.method = "GET";
    next.body = undefined;
    for (const name of REQUEST_BODY_HEADERS) headers.delete(name);
  }

  next.headers = headers;
  return next;
}

/**
 * Applique la borne de taille. `Content-Length` est déclaratif et absent d'une
 * réponse en codage par blocs : s'y fier laissait passer toute réponse qui ne
 * l'annonce pas. On lit donc le corps morceau par morceau, en abandonnant dès
 * le dépassement, puis on rend une réponse reconstruite sur les octets lus.
 *
 * Les appelants consomment tous la réponse eux-mêmes (`arrayBuffer`, `text`,
 * `json`) ou ne lisent que `status` : une réponse reconstruite leur reste donc
 * utilisable, statut et en-têtes compris. Seule `Response.url` est perdue,
 * qu'aucun point d'appel n'utilise. Sans `maxBytes`, la réponse d'origine est
 * rendue telle quelle et rien n'est lu ici.
 */
async function enforceMaxBytes(response: Response, maxBytes: number): Promise<Response> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new OutboundRequestError("too-large", "Réponse trop volumineuse");
  }

  // Une réponse sans corps (204, 304, corps déjà nul) ne peut pas être
  // reconstruite : le constructeur `Response` refuse un corps sur ces statuts.
  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new OutboundRequestError("too-large", "Réponse trop volumineuse");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Requête sortante vers une URL publique quelconque fournie par l'utilisateur.
 *
 * Chaque saut de redirection est revalidé avant d'être suivi : un hôte public
 * qui répond `302 Location: http://169.254.169.254/…` est arrêté là, ce que
 * `redirect: "follow"` laissait passer.
 */
export async function safeExternalFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const allowPrivateTargets = options.allowPrivateTargets ?? false;

  let url = parseUrl(rawUrl);
  let pinned = await assertReachableTarget(url, allowPrivateTargets);

  let init: RequestInit | undefined = options.init;

  for (let hop = 0; ; hop++) {
    const dispatcher = pinnedDispatcher(pinned);
    const response = await fetch(url, {
      ...init,
      redirect: "manual",
      signal,
      ...(dispatcher ? { dispatcher } : {}),
    } as RequestInit);

    if (response.status < 300 || response.status >= 400) {
      return options.maxBytes ? enforceMaxBytes(response, options.maxBytes) : response;
    }

    const location = response.headers.get("location");
    // Une 3xx sans en-tête `Location` n'est pas une redirection : on la rend.
    if (!location) {
      return options.maxBytes ? enforceMaxBytes(response, options.maxBytes) : response;
    }

    if (hop >= maxRedirects) {
      throw new OutboundRequestError("too-many-redirects", "Trop de redirections");
    }

    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new OutboundRequestError("invalid-url", "Redirection vers une URL invalide");
    }
    pinned = await assertReachableTarget(next, allowPrivateTargets);
    init = initForRedirect(init, response.status, url, next);
    url = next;
  }
}
