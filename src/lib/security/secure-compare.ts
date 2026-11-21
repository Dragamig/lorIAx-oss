import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare deux chaînes en temps constant.
 *
 * `timingSafeEqual` exige des tampons de même longueur : on compare donc les
 * empreintes SHA-256, toujours longues de 32 octets, ce qui évite de trahir
 * la longueur du secret par une sortie anticipée. L'égalité des longueurs est
 * ensuite vérifiée sans court-circuit, après la comparaison, pour écarter la
 * collision théorique de deux chaînes de longueurs différentes.
 *
 * Jumelle de `loriax-license-manager/src/lib/secure-compare.ts` : les deux
 * extrémités du secret partagé entre services doivent se comparer de
 * la même façon, sans quoi le défaut subsiste du côté resté en `!==`.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  const digestA = createHash("sha256").update(bufA).digest();
  const digestB = createHash("sha256").update(bufB).digest();

  const sameDigest = timingSafeEqual(digestA, digestB);
  const sameLength = bufA.length === bufB.length;

  return sameDigest && sameLength;
}

/**
 * Vérifie un en-tête `Authorization: Bearer <secret>` contre le secret partagé
 * entre loriax-app et loriax-license-manager.
 *
 * Ne lève jamais : en-tête absent, vide, sans préfixe « Bearer », ou secret
 * non configuré renvoient simplement false.
 */
export function isValidInternalBearer(
  authHeader: string | null,
  secret: string | undefined
): boolean {
  if (!secret) return false;
  if (!authHeader) return false;

  // Le schéma d'authentification est insensible à la casse (RFC 7235), et le
  // découpage tolère les espaces surnuméraires entre le schéma et le jeton.
  const match = /^Bearer[ \t]+(.+)$/i.exec(authHeader.trim());
  if (!match) return false;

  return timingSafeEqualString(match[1], secret);
}
