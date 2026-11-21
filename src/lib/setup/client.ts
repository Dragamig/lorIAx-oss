// src/lib/setup/client.ts
import { SETUP_TOKEN_HEADER } from "@/lib/setup/constants";

/**
 * Point d'appel UNIQUE de l'assistant d'installation côté navigateur.
 *
 * Pourquoi il existe (correctif du constat AZ-28, second tour).
 * `/api/setup/authorize` échangeait le jeton contre un cookie `httpOnly`
 * marqué `secure` dès que `NODE_ENV` vaut `production`. Or l'auto-hébergement
 * en conteneur tourne PRÉCISÉMENT en production, et l'exploitant ouvre
 * l'assistant sur une adresse en HTTP nu avant d'avoir monté TLS. Le
 * navigateur jetait donc silencieusement le cookie : l'écran de
 * déverrouillage voyait un 200, affichait l'assistant, et chaque étape
 * suivante recevait un 401 incompréhensible. L'installation était impossible
 * dans le cas le plus courant de l'auto-hébergement, ce qui est plus grave que
 * le défaut d'origine.
 *
 * Le serveur acceptait déjà l'en-tête `x-setup-token`, dont le front ne se
 * servait pas. On inverse donc les rôles : le JETON PORTÉ PAR L'EN-TÊTE fait
 * foi sur chaque appel, le cookie n'est plus qu'un confort qui évite de
 * ressaisir le jeton après un rechargement. Toutes les étapes de l'assistant
 * passent par `setupFetch`, pour ne pas recopier l'en-tête sur douze appels et
 * risquer d'en oublier un.
 *
 * OÙ LE JETON EST CONSERVÉ : `sessionStorage`.
 *  - il survit à un rechargement de page, ce dont l'assistant a besoin ;
 *  - il disparaît à la fermeture de l'onglet, donc il ne traîne pas sur un
 *    poste partagé après l'installation ;
 *  - il n'est jamais joint automatiquement à une requête, contrairement à un
 *    cookie : rien à contrefaire depuis un autre site ;
 *  - il est cloisonné par origine.
 * CONSÉQUENCE ASSUMÉE : le jeton est propre à l'onglet. Un rechargement le
 * conserve ; ouvrir l'assistant dans un NOUVEL onglet, ou dans une autre
 * fenêtre, oblige à le ressaisir (ou à s'appuyer sur le cookie, quand le
 * navigateur l'a accepté). `localStorage` aurait évité cette ressaisie au prix
 * d'un secret d'administration persistant sur le disque du poste, ce qui n'est
 * pas un bon échange pour un parcours qui ne dure que quelques minutes.
 */

const CLE_SESSION = "loriax.setup.bootstrapToken";

/**
 * Repli en mémoire quand `sessionStorage` est indisponible : le parcours reste
 * possible tant que l'onglet n'est pas rechargé.
 */
let memoire: string | null = null;

function stockage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    // Stockage refusé (navigation privée verrouillée, politique d'entreprise).
    return null;
  }
}

/** Jeton d'amorçage conservé pour cet onglet, ou null. */
export function getSetupToken(): string | null {
  const s = stockage();
  if (!s) return memoire;
  const valeur = s.getItem(CLE_SESSION);
  return valeur && valeur.length > 0 ? valeur : memoire;
}

/** Conserve le jeton pour la durée de l'onglet. */
export function setSetupToken(token: string): void {
  memoire = token;
  stockage()?.setItem(CLE_SESSION, token);
}

/** Oublie le jeton (fin de l'assistant, ou jeton refusé). */
export function clearSetupToken(): void {
  memoire = null;
  try {
    stockage()?.removeItem(CLE_SESSION);
  } catch {
    // Sans effet : la valeur en mémoire est déjà effacée.
  }
}

/**
 * `fetch` de l'assistant : ajoute le jeton d'amorçage sur CHAQUE appel.
 * `credentials: "same-origin"` conserve l'envoi du cookie quand le navigateur
 * l'a accepté, sans jamais en dépendre.
 */
export function setupFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getSetupToken();
  if (token) headers.set(SETUP_TOKEN_HEADER, token);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}

/**
 * Vérifie auprès du serveur que l'autorisation TIENT RÉELLEMENT, au lieu de se
 * fier au seul 200 de `/api/setup/authorize` : c'est exactement ce que le
 * navigateur pouvait avoir rejeté en jetant le cookie.
 */
export async function isSetupAuthorized(): Promise<boolean> {
  try {
    const res = await setupFetch("/api/setup/authorize");
    if (!res.ok) return false;
    const body = await res.json();
    return body?.authorized === true;
  } catch {
    return false;
  }
}
