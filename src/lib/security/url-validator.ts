/**
 * SSRF protection — blocs vers IPs privées / hostnames internes.
 * Fichier isomorphe (utilisé client + serveur). `assertPublicHostname`
 * (qui dépend de `dns`) est dans `url-validator-server.ts`.
 */

export const PRIVATE_IP_RANGES = [
  /^127\./, // loopback (127.0.0.0/8, tout le premier octet)
  /^10\./, // class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // class B private
  /^192\.168\./, // class C private
  /^169\.254\./, // link-local (cloud metadata!)
  /^0\./, // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT shared address space (RFC 6598)
  /^192\.0\.0\./, // IETF protocol assignments, includes the Oracle Cloud metadata service
  /^198\.(18|19)\./, // network benchmark range (RFC 2544)
  /^::1$/, // IPv6 loopback
  // IPv6 « unspecified » (`::`) et toute la plage ::/96, dite IPv4-compatible.
  // `new URL("http://[::]/").hostname` vaut `[::]` : un service en écoute IPv6
  // ou double pile (cas par défaut de beaucoup de conteneurs) y répond comme
  // sur le loopback. La forme IPv4-compatible est dépréciée (RFC 4291, adresses IPv4-compatibles)
  // et le parseur WHATWG canonise `[::127.0.0.1]` en `[::7f00:1]` : au plus
  // deux groupes hexadécimaux après le `::`. La forme IPv4-mapped légitime
  // (`::ffff:a:b`, trois groupes) est traitée en amont par extractMappedIPv4
  // et n'atteint jamais cette expression.
  /^::([0-9a-f]{1,4}(:[0-9a-f]{1,4})?)?$/i,
  /^f[cd][0-9a-f]{0,2}:/i, // IPv6 unique local, fc00::/7 (fc00-fdff), couvre fc00: et fd00:
  /^fe[89ab][0-9a-f]:/i, // IPv6 link-local, fe80::/10 (fe80-febf)
  /^fe[c-f][0-9a-f]:/i, // IPv6 site-local déprécié, fec0::/10 (fec0-feff)
  /^ff[0-9a-f]{2}:/i, // IPv6 multicast, ff00::/8 (ff00-ffff), utile au balayage
];

// IPv6-mapped IPv4, forme historique pointée : ::ffff:x.x.x.x
export const IPV6_MAPPED_IPV4_PREFIX = /^::ffff:(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/i;

// IPv6-mapped IPv4, forme canonique produite par le parseur WHATWG : les 32
// bits de l'IPv4 sont affichés en deux groupes hexadécimaux plutôt qu'en
// notation pointée. `new URL("http://[::ffff:127.0.0.1]/").hostname` vaut
// `[::ffff:7f00:1]`, jamais `[::ffff:127.0.0.1]` : sans cette forme,
// IPV6_MAPPED_IPV4_PREFIX ne matchait jamais aucune URL réelle.
const IPV6_MAPPED_IPV4_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

const BLOCKED_HOSTNAMES = [
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
];

/**
 * Simple IPv4 check using regex (avoids Node.js net module).
 * Chaque segment doit être une suite de 1 à 3 chiffres décimaux (pas de
 * signe, pas d'espace, pas de notation scientifique) valant au plus 255.
 */
export function isIPv4(hostname: string): boolean {
  const parts = hostname.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

/**
 * Retire les crochets d'un hostname IPv6 littéral. `URL.hostname` inclut
 * toujours les crochets pour un littéral IPv6 (`[::1]`, jamais `::1`) ;
 * les regex de plages IPv6 attendent l'adresse nue.
 */
function stripIPv6Brackets(hostname: string): string {
  if (hostname.length > 2 && hostname[0] === "[" && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Développe une IPv6 nue en 8 groupes de 16 bits (forme pointée finale
 * acceptée). Renvoie `null` si la chaîne n'est pas une IPv6 valide.
 */
function expandIPv6(bare: string): number[] | null {
  let text = bare;
  const dotted = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    if (!isIPv4(dotted[2])) return null;
    const o = dotted[2].split(".").map(Number);
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const groups = part.split(":");
    if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
    return groups.map((g) => parseInt(g, 16));
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * IPv4 embarquée dans une IPv6 de traduction ou de tunnel, que les règles
 * IPv4 doivent juger à sa place : NAT64 (64:ff9b::/96), 6to4 (2002::/16),
 * IPv4-mapped (::ffff:0:0/96) et IPv4-translated SIIT (::ffff:0:0:0/96).
 */
function extractEmbeddedIPv4(bare: string): string | null {
  const g = expandIPv6(bare);
  if (!g) return null;
  const v4 = (hi: number, lo: number) =>
    [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join(".");
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return v4(g[6], g[7]);
  if (g[0] === 0x2002) return v4(g[1], g[2]);
  if (zero(0, 5) && g[5] === 0xffff) return v4(g[6], g[7]);
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return v4(g[6], g[7]);
  return null;
}

/**
 * Si `hostname` désigne, directement ou via une IPv6 qui la mappe, une
 * adresse IPv4 littérale, renvoie cette adresse en notation pointée.
 * Couvre la forme pointée historique (`::ffff:127.0.0.1`) et la forme
 * hexadécimale canonique du parseur WHATWG (`::ffff:7f00:1`). Renvoie
 * `null` si `hostname` n'est ni l'un ni l'autre (domaine, ou IPv6 pure).
 */
function extractMappedIPv4(hostname: string): string | null {
  const bare = stripIPv6Brackets(hostname);

  if (isIPv4(bare)) {
    return bare;
  }

  const dotted = IPV6_MAPPED_IPV4_PREFIX.exec(bare);
  if (dotted) {
    return `${dotted[1]}.${dotted[2]}.${dotted[3]}.${dotted[4]}`;
  }

  const hex = IPV6_MAPPED_IPV4_HEX.exec(bare);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(".");
  }

  return extractEmbeddedIPv4(bare);
}

/**
 * Check if a URL points to a private/internal network address.
 * Blocks: loopback, private ranges, link-local, cloud metadata, .local hostnames.
 */
export function isPrivateUrl(url: URL): boolean {
  const hostname = url.hostname;

  // IPv4 littérale, ou IPv6 mappant une IPv4 (forme pointée ou hexadécimale)
  const mappedIPv4 = extractMappedIPv4(hostname);
  if (mappedIPv4) {
    return PRIVATE_IP_RANGES.some((r) => r.test(mappedIPv4));
  }

  // Pure IPv6 ranges (crochets retirés)
  if (PRIVATE_IP_RANGES.some((r) => r.test(stripIPv6Brackets(hostname)))) {
    return true;
  }

  // Hostname-based checks
  if (BLOCKED_HOSTNAMES.includes(hostname.toLowerCase())) {
    return true;
  }

  // Block .local and .internal TLDs (mDNS, internal DNS)
  if (
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    return true;
  }

  return false;
}

export interface ValidateExternalUrlOptions {
  /**
   * Lève le refus des adresses privées/locales, en gardant le contrôle de
   * protocole. Réservé aux instances auto-hébergées qui visent volontairement
   * un service interne (ex: un webhook vers `http://n8n:5678`). Ce fichier
   * est isomorphe (importé côté client) : la valeur doit venir de l'appelant
   * serveur, jamais d'une lecture d'environnement faite ici.
   */
  allowPrivateTargets?: boolean;
}

/**
 * Validate a URL for external fetch: must be http(s) and not target a private network.
 * Returns an error message if invalid, or null if the URL is safe.
 */
export function validateExternalUrl(
  url: string,
  options?: ValidateExternalUrlOptions
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "URL invalide";
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Protocole non supporté";
  }

  if (!options?.allowPrivateTargets && isPrivateUrl(parsed)) {
    return "Les URL pointant vers des adresses privées ou locales ne sont pas autorisées";
  }

  return null;
}

// `assertPublicHostname` (DNS lookup, server-only) déplacée dans
// `url-validator-server.ts` pour ne pas casser le bundling client.
