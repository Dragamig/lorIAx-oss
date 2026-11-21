/**
 * Service du runtime de présentation (Bento vendorisé).
 *
 * Le fichier n'est pas servi depuis `public/` : la CSP globale de
 * `src/proxy.ts` impose `script-src 'self' 'nonce-…' 'strict-dynamic'`, ce qui
 * tuerait les scripts inline de cet artefact autoportant. Cette route pose donc
 * sa propre politique, plus permissive sur l'exécution locale et bien plus
 * stricte sur le réseau : `connect-src 'none'` garantit que le runtime
 * n'atteint aucun serveur, tout passant par le pont `postMessage`.
 *
 * Le middleware exempte ce chemin de la politique verrouillée des API, mais
 * exige la session : voir la branche dédiée dans `src/proxy.ts`.
 */
import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { RUNTIME_BRIDGE_SCRIPT } from "@/lib/presentations/runtime-bridge-script";
import { BLANK_DECK, BRAND_CSS, RUNTIME_ASSEMBLY_HASH } from "@/lib/presentations/runtime-assembly";
import { KNOWN_RUNTIME_VERSIONS } from "@/lib/presentations/runtime";
import { getSessionUser } from "@/lib/auth/get-user";
import { guardPresentationsModule } from "@/lib/presentations/guards";

/** Catalogues embarqués par le runtime, seules valeurs acceptées en requête. */
const RUNTIME_LANGS = new Set([
  "en", "fr", "es", "de", "it", "pt", "ja", "zh-Hans", "zh-Hant",
]);

/**
 * Politique de la réponse.
 *
 * `unsafe-inline` et `unsafe-eval` sont inhérents à l'artefact : son code est
 * inline, compressé et réhydraté au chargement. Ce qui rend la chose tenable,
 * c'est l'origine opaque de l'iframe (ni cookie, ni stockage, ni DOM de
 * l'application) et `connect-src 'none'`, qui coupe toute exfiltration.
 * `frame-ancestors 'self'` empêche un tiers d'encadrer le runtime.
 */
const RUNTIME_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-ancestors 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const DOC_TAG_OPEN = '<script type="application/bento+json" id="bento-doc">';

/**
 * Mémoire de processus : l'artefact fait près de 700 Ko et sa préparation
 * (lecture disque, deux substitutions de chaîne) n'a aucune raison d'être
 * refaite. La clé est la version, et une version ne change jamais de contenu.
 */
const prepared = new Map<string, string>();

/**
 * Le cache est désactivé en développement : le pont injecté est du code que
 * l'on modifie, et une mémoire de processus le figeait, laissant croire à un
 * changement sans effet. En production, la version ne bouge jamais.
 */
const CACHEABLE = process.env.NODE_ENV === "production";

async function prepareRuntime(version: string, lang: string): Promise<string> {
  const cacheKey = `${version}:${lang}`;
  const cached = CACHEABLE ? prepared.get(cacheKey) : undefined;
  if (cached) return cached;

  const file = path.join(
    process.cwd(),
    "vendor",
    "bento",
    version,
    "bento-runtime.html"
  );
  let html = await readFile(file, "utf-8");

  // Document de démarrage. Le runtime échappe lui-même le chevron ouvrant en
  // séquence unicode quand il réécrit cette balise : on fait pareil, sans quoi
  // une chaîne contenant une balise fermante couperait le fichier en deux.
  const docTagIndex = html.indexOf(DOC_TAG_OPEN);
  if (docTagIndex === -1) {
    throw new Error("Balise #bento-doc absente de l'artefact vendorisé");
  }
  const contentStart = docTagIndex + DOC_TAG_OPEN.length;
  const contentEnd = html.indexOf("</" + "script>", contentStart);
  html =
    html.slice(0, contentStart) +
    BLANK_DECK.replace(/</g, "\\u003c") +
    html.slice(contentEnd);

  // Pont, posé avant le chargeur du bundle : il doit intercepter l'affectation
  // de `window.bento` et neutraliser BroadcastChannel avant tout démarrage.
  const headEnd = html.indexOf("</" + "head>");
  if (headEnd === -1) {
    throw new Error("Section head absente de l'artefact vendorisé");
  }
  html =
    html.slice(0, headEnd) +
    "<" +
    "script>" +
    `window.__LORIAX_BENTO_LANG__ = ${JSON.stringify(lang)};` +
    RUNTIME_BRIDGE_SCRIPT +
    "</" +
    "script>" +
    "<" +
    "style>" +
    BRAND_CSS +
    "</" +
    "style>" +
    html.slice(headEnd);

  prepared.set(cacheKey, html);
  return html;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ version: string }> }
) {
  const { version } = await params;

  // Le moteur suit le sort du module : coupé, il n'est plus servi du tout.
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const blocked = await guardPresentationsModule(user);
  if (blocked) return blocked;

  // Langue du moteur, choisie par l'application et bornée à ses catalogues.
  const requested = new URL(request.url).searchParams.get("lang") ?? "en";
  const lang = RUNTIME_LANGS.has(requested) ? requested : "en";

  // La version vient de l'URL : elle ne sert de segment de chemin qu'une fois
  // reconnue dans une liste fermée. Aucune normalisation, aucune remontée de
  // répertoire possible.
  if (!KNOWN_RUNTIME_VERSIONS.has(version)) {
    return NextResponse.json({ error: "Version inconnue" }, { status: 404 });
  }

  const bundleMatches = new URL(request.url).searchParams.get("b") === RUNTIME_ASSEMBLY_HASH;

  let html: string;
  try {
    html = await prepareRuntime(version, lang);
  } catch (err) {
    console.error("[presentations/runtime] Artefact illisible :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }

  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": RUNTIME_CSP,
      "X-Content-Type-Options": "nosniff",
      // `private` : réponse authentifiée et filtrée par module, jamais pour un
      // cache partagé. `immutable` seulement si l'URL porte le hachage du pont
      // et du CSS (`b`, voir `runtimeUrl`) : sans lui, un correctif du pont
      // resterait invisible chez qui a déjà la page.
      "Cache-Control": !CACHEABLE
        ? "no-store"
        : bundleMatches
          ? "private, max-age=31536000, immutable"
          : "private, max-age=0, must-revalidate",
    },
  });
}
