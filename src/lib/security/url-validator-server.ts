import { promises as dns } from "dns";
import { isIPv4, isPrivateUrl } from "@/lib/security/url-validator";

/**
 * Anti DNS rebinding — résout le hostname et vérifie que toutes les IPs renvoyées
 * sont publiques. À appeler juste avant un `fetch` sortant vers une URL
 * fournie par l'utilisateur. Lève une Error si une IP privée est résolue.
 *
 * Renvoie les adresses validées (liste vide pour un littéral IP). Pour fermer
 * la fenêtre TOCTOU entre cette résolution et celle de fetch(), l'appelant
 * sensible fige ces adresses à la connexion (voir `safeExternalFetch`).
 */
export async function resolvePublicAddresses(
  url: URL,
): Promise<{ address: string; family: number }[]> {
  const hostname = url.hostname;

  // `hostname` est déjà un littéral (IPv4 nue, ou IPv6 entre crochets, mappant
  // ou non une IPv4) : rien à résoudre, `isPrivateUrl` couvre tous ces cas.
  // Un nom de domaine ne commence jamais par `[`.
  if (isIPv4(hostname) || hostname.startsWith("[")) {
    if (isPrivateUrl(url)) {
      throw new Error("URL résolue vers une adresse privée");
    }
    return [];
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new Error("Résolution DNS impossible");
  }

  for (const { address, family } of addresses) {
    const probe = new URL(url.toString());
    // `URL.hostname` rejette silencieusement une IPv6 sans les crochets
    // (l'affectation est un no-op) : sans ce test sur `family`, une réponse
    // DNS AAAA n'était jamais réellement revalidée.
    probe.hostname = family === 6 ? `[${address}]` : address;
    if (isPrivateUrl(probe)) {
      throw new Error("URL résolue vers une adresse privée");
    }
  }
  return addresses;
}

/** Variante sans valeur de retour : lève si l'hôte résout vers une adresse privée. */
export async function assertPublicHostname(url: URL): Promise<void> {
  await resolvePublicAddresses(url);
}
