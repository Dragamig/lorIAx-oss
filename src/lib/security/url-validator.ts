/**
 * SSRF protection: blocks requests to private/internal network ranges.
 *
 * Address classification is done by *parsing* the address with `node:net`
 * rather than by matching the raw hostname string. This covers IPv6 literals
 * (which `URL.hostname` returns wrapped in brackets), compressed IPv6 forms,
 * IPv4-mapped / IPv4-compatible IPv6, 6to4 and NAT64 embeddings, plus the
 * CGNAT, broadcast, multicast and reserved ranges.
 *
 * Server-only module (imports `node:net`). Do not import from client code.
 */

import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa"];

export const PRIVATE_URL_MESSAGE =
  "Les URL pointant vers des adresses privées ou locales ne sont pas autorisées";

/**
 * Lowercase a hostname and strip IPv6 brackets, IPv6 zone id and trailing dots
 * so that comparisons and address parsing operate on a canonical form.
 */
export function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  const zoneIndex = host.indexOf("%");
  if (zoneIndex !== -1) {
    host = host.slice(0, zoneIndex);
  }
  while (host.endsWith(".")) {
    host = host.slice(0, -1);
  }
  return host;
}

function parseIpv4(value: string): Uint8Array | null {
  if (!net.isIPv4(value)) return null;
  const parts = value.split(".");
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    bytes[i] = Number(parts[i]);
  }
  return bytes;
}

function parseIpv6(value: string): Uint8Array | null {
  if (!net.isIPv6(value)) return null;

  let text = value;

  // Trailing IPv4 form (::ffff:10.0.0.1) -> rewrite the tail as two hex groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const tailBytes = parseIpv4(tail);
    if (!tailBytes) return null;
    const high = ((tailBytes[0] << 8) | tailBytes[1]).toString(16);
    const low = ((tailBytes[2] << 8) | tailBytes[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const provided = head.length + rest.length;
  if (provided > 8) return null;
  if (halves.length === 1 && provided !== 8) return null;

  const groups: number[] = [];
  for (const group of head) groups.push(parseInt(group, 16));
  for (let i = provided; i < 8; i++) groups.push(0);
  for (const group of rest) groups.push(parseInt(group, 16));
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) {
    return null;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

function isZeroRange(bytes: Uint8Array, start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

function isPrivateIpv4Bytes(b: Uint8Array): boolean {
  const [a, second, third] = [b[0], b[1], b[2]];

  if (a === 0) return true; // 0.0.0.0/8 "this" network
  if (a === 10) return true; // private class A
  if (a === 127) return true; // loopback
  if (a === 100 && second >= 64 && second <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 169 && second === 254) return true; // link-local, cloud metadata
  if (a === 172 && second >= 16 && second <= 31) return true; // private class B
  if (a === 192 && second === 0 && third === 0) return true; // IETF protocol assignments
  if (a === 192 && second === 0 && third === 2) return true; // TEST-NET-1
  if (a === 192 && second === 88 && third === 99) return true; // 6to4 relay anycast
  if (a === 192 && second === 168) return true; // private class C
  if (a === 198 && (second === 18 || second === 19)) return true; // benchmarking
  if (a === 198 && second === 51 && third === 100) return true; // TEST-NET-2
  if (a === 203 && second === 0 && third === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4, reserved 240/4, broadcast

  return false;
}

function isPrivateIpv6Bytes(b: Uint8Array): boolean {
  // IPv4-mapped ::ffff:0:0/96
  if (isZeroRange(b, 0, 10) && b[10] === 0xff && b[11] === 0xff) {
    return isPrivateIpv4Bytes(b.slice(12));
  }
  // IPv4-compatible ::/96, also covers :: and ::1
  if (isZeroRange(b, 0, 12)) {
    return isPrivateIpv4Bytes(b.slice(12));
  }
  // NAT64 well-known prefix 64:ff9b::/96
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && isZeroRange(b, 4, 12)) {
    return isPrivateIpv4Bytes(b.slice(12));
  }
  // 6to4 2002::/16 embeds an IPv4 address
  if (b[0] === 0x20 && b[1] === 0x02) {
    return isPrivateIpv4Bytes(b.slice(2, 6));
  }
  // 100::/64 discard-only
  if (b[0] === 0x01 && b[1] === 0x00 && isZeroRange(b, 2, 8)) return true;
  // 2001:db8::/32 documentation
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true;
  // 2001::/23 IETF protocol assignments (Teredo, ORCHID, ...)
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] < 0x02) return true;
  // fc00::/7 unique local
  if ((b[0] & 0xfe) === 0xfc) return true;
  // fe80::/10 link-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;
  // fec0::/10 site-local (deprecated but still routed internally)
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;
  // ff00::/8 multicast
  if (b[0] === 0xff) return true;

  return false;
}

/**
 * True when the given literal IP address belongs to a non-public range.
 * Returns false for anything that is not a valid IP literal.
 */
export function isPrivateIp(address: string): boolean {
  const host = normalizeHostname(address);

  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4Bytes(v4);

  const v6 = parseIpv6(host);
  if (v6) return isPrivateIpv6Bytes(v6);

  return false;
}

/** True when the value is a literal IPv4 or IPv6 address. */
export function isIpLiteral(value: string): boolean {
  return net.isIP(normalizeHostname(value)) !== 0;
}

/**
 * Hostname-level check: literal private IPs plus internal naming conventions.
 * This is a string-level guard only, it does not resolve DNS. Use `safeFetch`
 * for outgoing requests, which additionally validates every resolved address.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return true;

  if (net.isIP(host) !== 0) return isPrivateIp(host);

  if (BLOCKED_HOSTNAMES.has(host)) return true;

  return BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Check if a URL points to a private/internal network address.
 * Blocks: loopback, private ranges, CGNAT, link-local, cloud metadata,
 * multicast, reserved ranges and .local/.internal hostnames.
 */
export function isPrivateUrl(url: URL): boolean {
  return isPrivateHostname(url.hostname);
}

/**
 * Validate a URL for external fetch: must be http(s) and not target a private network.
 * Returns an error message if invalid, or null if the URL is safe.
 */
export function validateExternalUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL invalide";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Protocole non supporté";
  }

  if (isPrivateUrl(parsed)) {
    return PRIVATE_URL_MESSAGE;
  }

  return null;
}
