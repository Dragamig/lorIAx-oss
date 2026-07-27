/**
 * safeFetch: hardened replacement for `fetch` on every server-side outgoing
 * request whose URL can be influenced by a user or by configuration.
 *
 * Guarantees:
 *  - http/https only;
 *  - the hostname is resolved with `dns.lookup(host, { all: true })` and the
 *    request is refused as soon as ONE of the resolved addresses is private,
 *    loopback, link-local, unique-local, CGNAT, broadcast, reserved or multicast;
 *  - the socket connects to a pinned address taken from that very resolution,
 *    so a second DNS answer cannot substitute an internal address (DNS
 *    rebinding). The `Host` header and the TLS SNI / certificate check keep
 *    using the original hostname;
 *  - redirects are never followed by the transport (node:http does not follow
 *    them). They are followed by this module, revalidating every hop in full,
 *    with a hop cap;
 *  - a global deadline and a decompressed response size cap are always enforced;
 *  - compressed responses are decompressed here (node:zlib). An encoding we
 *    cannot decode fails loudly instead of handing back an unreadable body.
 *
 * `allowPrivate: true` is an explicit opt-out reserved for destinations whose
 * URL comes from server configuration (env vars or `system_settings`), never
 * from end-user input. Self-hosted deployments legitimately target Ollama,
 * Whisper or LiveKit on a private address.
 *
 * Server-only module (imports node:http / node:https / node:dns / node:zlib).
 */

import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import type dns from "node:dns";
import { lookup } from "node:dns/promises";

import {
  PRIVATE_URL_MESSAGE,
  isPrivateHostname,
  isPrivateIp,
  normalizeHostname,
} from "@/lib/security/url-validator";

export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked_protocol"
  | "blocked_address"
  | "dns_failure"
  | "too_many_redirects"
  | "response_too_large"
  | "unsupported_encoding"
  | "timeout"
  | "network";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(message: string, code: SafeFetchErrorCode) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

/** Errors caused by the caller supplying a forbidden target, not by the network. */
export function isBlockedTargetError(err: unknown): err is SafeFetchError {
  return (
    err instanceof SafeFetchError &&
    (err.code === "invalid_url" ||
      err.code === "blocked_protocol" ||
      err.code === "blocked_address" ||
      err.code === "dns_failure")
  );
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Only replayable bodies are supported, so redirects can be re-issued. */
  body?: string | Buffer | Uint8Array;
  signal?: AbortSignal;
  /** Global deadline covering every redirect hop. Default 10s. */
  timeoutMs?: number;
  /** Maximum number of DECOMPRESSED response bytes buffered. Default 5 MiB. */
  maxBytes?: number;
  /** Maximum number of redirects followed. Default 5. */
  maxRedirects?: number;
  /** Return the 3xx response instead of following it. Default true (follow). */
  followRedirects?: boolean;
  /**
   * Allow private/internal destinations. Reserved for URLs coming exclusively
   * from server configuration. Never enable it for user-supplied URLs.
   */
  allowPrivate?: boolean;
}

export interface PinnedAddress {
  address: string;
  family: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
// fetch() allows 20 hops. 5 covers the usual http -> https -> www -> canonical
// chains without turning the helper into a redirect crawler.
const DEFAULT_MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
// content-encoding and content-length are dropped because the body handed back
// is already decompressed: keeping them would describe bytes that no longer exist.
const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface HeaderEntry {
  /** Original casing, preserved so receivers see X-LorIAx-Signature untouched. */
  name: string;
  value: string;
}

type HeaderBag = Map<string, HeaderEntry>;

function makeHeaderBag(headers: Record<string, string>): HeaderBag {
  const bag: HeaderBag = new Map();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    bag.set(name.toLowerCase(), { name, value: String(value) });
  }
  return bag;
}

function setHeader(bag: HeaderBag, name: string, value: string): void {
  const key = name.toLowerCase();
  const existing = bag.get(key);
  bag.set(key, { name: existing?.name ?? name, value });
}

function toOutgoingHeaders(bag: HeaderBag): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of bag.values()) {
    out[entry.name] = entry.value;
  }
  return out;
}

function toUrl(input: string | URL): URL {
  if (input instanceof URL) return input;
  try {
    return new URL(input);
  } catch {
    throw new SafeFetchError("URL invalide", "invalid_url");
  }
}

function assertSupportedProtocol(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("Protocole non supporté", "blocked_protocol");
  }
}

/**
 * Resolve a hostname and return the addresses the socket is allowed to use.
 * Throws as soon as one resolved address is not publicly routable, unless
 * `allowPrivate` is set.
 */
export async function resolvePinnedAddresses(
  hostname: string,
  allowPrivate = false
): Promise<PinnedAddress[]> {
  const host = normalizeHostname(hostname);
  if (!host) {
    throw new SafeFetchError("URL invalide", "invalid_url");
  }

  const literalFamily = net.isIP(host);
  if (literalFamily !== 0) {
    if (!allowPrivate && isPrivateIp(host)) {
      throw new SafeFetchError(PRIVATE_URL_MESSAGE, "blocked_address");
    }
    return [{ address: host, family: literalFamily }];
  }

  if (!allowPrivate && isPrivateHostname(host)) {
    throw new SafeFetchError(PRIVATE_URL_MESSAGE, "blocked_address");
  }

  let resolved: dns.LookupAddress[];
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError("Nom de domaine introuvable", "dns_failure");
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new SafeFetchError("Nom de domaine introuvable", "dns_failure");
  }

  if (!allowPrivate) {
    for (const entry of resolved) {
      if (isPrivateIp(entry.address)) {
        throw new SafeFetchError(PRIVATE_URL_MESSAGE, "blocked_address");
      }
    }
  }

  return resolved.map((entry) => ({ address: entry.address, family: entry.family }));
}

/**
 * Build a `lookup` implementation that always returns the pinned addresses,
 * so the connection cannot land on a host resolved a second time.
 */
function pinnedLookup(addresses: PinnedAddress[]): net.LookupFunction {
  return (hostname, options, callback) => {
    const rawFamily = options?.family;
    const family =
      rawFamily === "IPv4" ? 4 : rawFamily === "IPv6" ? 6 : typeof rawFamily === "number" ? rawFamily : 0;
    const wantAll = options?.all === true;

    const candidates =
      family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses;

    if (candidates.length === 0) {
      const err: NodeJS.ErrnoException = new Error(
        `Aucune adresse autorisée pour ${hostname}`
      );
      err.code = "ENOTFOUND";
      callback(err, wantAll ? [] : "");
      return;
    }

    if (wantAll) {
      callback(
        null,
        candidates.map((a) => ({ address: a.address, family: a.family }))
      );
      return;
    }

    callback(null, candidates[0].address, candidates[0].family);
  };
}

/**
 * Pick a decompressor for the advertised content-encoding.
 * Returns null for identity. Throws for an encoding we cannot decode: handing
 * back an undecodable body with its content-encoding stripped would be a silent
 * corruption, so this fails loudly instead.
 */
function createDecompressor(encoding: string | undefined): zlib.Gzip | null {
  const normalized = (encoding ?? "").trim().toLowerCase();
  if (!normalized || normalized === "identity") return null;

  switch (normalized) {
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip() as unknown as zlib.Gzip;
    case "deflate":
      return zlib.createInflate() as unknown as zlib.Gzip;
    case "br":
      return zlib.createBrotliDecompress() as unknown as zlib.Gzip;
    case "zstd": {
      const factory = (zlib as unknown as { createZstdDecompress?: () => zlib.Gzip })
        .createZstdDecompress;
      if (typeof factory === "function") return factory();
      throw new SafeFetchError(
        `Encodage de réponse non supporté : ${normalized}`,
        "unsupported_encoding"
      );
    }
    default:
      throw new SafeFetchError(
        `Encodage de réponse non supporté : ${normalized}`,
        "unsupported_encoding"
      );
  }
}

interface RawResponse {
  status: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

interface ExecuteOptions {
  method: string;
  headers: Record<string, string>;
  body?: string | Buffer | Uint8Array;
  signal: AbortSignal;
  maxBytes: number;
}

function executeRequest(
  target: URL,
  addresses: PinnedAddress[],
  options: ExecuteOptions
): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const transport = isHttps ? https : http;
    const port = target.port ? Number(target.port) : isHttps ? 443 : 80;

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const succeed = (value: RawResponse) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const requestOptions: https.RequestOptions & {
      autoSelectFamily?: boolean;
    } = {
      protocol: target.protocol,
      hostname: normalizeHostname(target.hostname),
      port,
      path: `${target.pathname}${target.search}`,
      method: options.method,
      headers: options.headers,
      lookup: pinnedLookup(addresses),
      // Try every pinned address (Happy Eyeballs) so a host resolving to both
      // IPv4 and IPv6 still connects when only one family is listening.
      autoSelectFamily: true,
      // No connection pooling: guarantees our pinned lookup is used for the
      // socket of this very request.
      agent: false,
      signal: options.signal,
    };

    const req = transport.request(requestOptions, (res) => {
      let decompressor: zlib.Gzip | null;
      try {
        decompressor = createDecompressor(res.headers["content-encoding"]);
      } catch (err) {
        res.destroy();
        req.destroy();
        fail(err as Error);
        return;
      }

      const abortStreams = () => {
        decompressor?.destroy();
        res.destroy();
        req.destroy();
      };

      const source: Readable = decompressor ? res.pipe(decompressor) : res;
      const chunks: Buffer[] = [];
      let size = 0;

      source.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          abortStreams();
          fail(new SafeFetchError("Réponse trop volumineuse", "response_too_large"));
          return;
        }
        chunks.push(chunk);
      });

      source.on("error", (err) => {
        abortStreams();
        fail(err);
      });
      if (decompressor) {
        res.on("error", (err) => {
          abortStreams();
          fail(err);
        });
      }

      source.on("end", () => {
        succeed({
          status: res.statusCode ?? 502,
          statusText: res.statusMessage ?? "",
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on("error", (err) => fail(err));

    if (options.body !== undefined && options.method !== "GET" && options.method !== "HEAD") {
      req.write(options.body);
    }
    req.end();
  });
}

function buildResponse(raw: RawResponse, finalUrl: URL): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw.headers)) {
    if (STRIPPED_RESPONSE_HEADERS.has(key)) continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }

  const statusText = /^[\x20-\x7e]*$/.test(raw.statusText) ? raw.statusText : "";
  // Copy into a plain Uint8Array: Buffer is backed by ArrayBufferLike, which
  // does not satisfy BodyInit.
  const body = NULL_BODY_STATUSES.has(raw.status) ? null : new Uint8Array(raw.body);

  const response = new Response(body, {
    status: raw.status,
    statusText,
    headers,
  });

  try {
    Object.defineProperty(response, "url", { value: finalUrl.href, configurable: true });
  } catch {
    // Non fatal: the caller keeps its own reference to the requested URL.
  }

  return response;
}

function combineSignals(timeoutSignal: AbortSignal, userSignal?: AbortSignal): AbortSignal {
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeoutSignal, userSignal]);
  }
  const controller = new AbortController();
  const abort = (reason: unknown) => controller.abort(reason);
  timeoutSignal.addEventListener("abort", () => abort(timeoutSignal.reason), { once: true });
  userSignal.addEventListener("abort", () => abort(userSignal.reason), { once: true });
  return controller.signal;
}

/**
 * Credentials carried by the URL (http://user:pass@host) are turned into an
 * explicit Basic header: node:http ignores them, so they would otherwise be
 * dropped silently and the target would answer 401 without explanation.
 */
function applyUrlCredentials(bag: HeaderBag, target: URL): void {
  if (!target.username && !target.password) return;
  if (bag.has("authorization")) return;
  const raw = `${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`;
  setHeader(bag, "Authorization", `Basic ${Buffer.from(raw).toString("base64")}`);
}

/**
 * Perform an outgoing HTTP(S) request with full SSRF protection.
 * Throws `SafeFetchError` for refused targets, timeouts, unsupported response
 * encodings and oversized bodies.
 */
export async function safeFetch(
  input: string | URL,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const {
    method = "GET",
    headers = {},
    body,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    followRedirects = true,
    allowPrivate = false,
  } = options;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const abortSignal = combineSignals(timeoutSignal, signal);

  let target = toUrl(input);
  let currentMethod = method.toUpperCase();
  let currentBody = body;
  const headerBag = makeHeaderBag(headers);
  setHeader(headerBag, "Accept-Encoding", "gzip, deflate, br");
  applyUrlCredentials(headerBag, target);

  for (let redirects = 0; ; redirects++) {
    assertSupportedProtocol(target);
    const addresses = await resolvePinnedAddresses(target.hostname, allowPrivate);

    // Explicit length avoids chunked encoding, which some receivers reject.
    if (currentBody !== undefined && currentMethod !== "GET" && currentMethod !== "HEAD") {
      setHeader(headerBag, "Content-Length", String(Buffer.byteLength(currentBody)));
    } else {
      headerBag.delete("content-length");
    }

    let raw: RawResponse;
    try {
      raw = await executeRequest(target, addresses, {
        method: currentMethod,
        headers: toOutgoingHeaders(headerBag),
        body: currentBody,
        signal: abortSignal,
        maxBytes,
      });
    } catch (err) {
      if (err instanceof SafeFetchError) throw err;
      if (timeoutSignal.aborted) {
        throw new SafeFetchError("Délai d'attente dépassé", "timeout");
      }
      if (signal?.aborted) {
        throw new SafeFetchError("Requête annulée", "timeout");
      }
      // The raw Node message leaks the resolved address and port
      // ("connect ECONNREFUSED 93.184.216.34:22"). Callers must never echo a
      // "network" message back to an end user: log it server side instead.
      const message = err instanceof Error ? err.message : "Erreur réseau";
      throw new SafeFetchError(message, "network");
    }

    const location = raw.headers.location;
    if (!REDIRECT_STATUSES.has(raw.status) || !location || !followRedirects) {
      return buildResponse(raw, target);
    }

    if (redirects >= maxRedirects) {
      throw new SafeFetchError("Trop de redirections", "too_many_redirects");
    }

    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      throw new SafeFetchError("Redirection invalide", "invalid_url");
    }

    if (
      raw.status === 303 ||
      ((raw.status === 301 || raw.status === 302) &&
        currentMethod !== "GET" &&
        currentMethod !== "HEAD")
    ) {
      currentMethod = "GET";
      currentBody = undefined;
      headerBag.delete("content-type");
      headerBag.delete("content-length");
    }

    if (next.origin !== target.origin) {
      headerBag.delete("authorization");
      headerBag.delete("cookie");
    }
    applyUrlCredentials(headerBag, next);

    target = next;
  }
}
