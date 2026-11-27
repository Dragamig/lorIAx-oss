import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { getLiveKitUrlForCsp } from "@/lib/meet/livekit-config";
import { isMediaReadPath } from "@/lib/media/frame-policy";
import { getHttpHooks } from "@/lib/modules/hooks.http";

const publicPaths = ["/login", "/register", "/check-email", "/verify-email", "/forgot-password", "/reset-password", "/public", "/offline"];

// Alternation générée depuis LOCALES — ne jamais hardcoder la liste ici
// (une locale ajoutée dans config.ts serait sinon silencieusement ignorée).
const LOCALE_ALTERNATION = LOCALES.join("|");
const LOCALE_PREFIX_RE = new RegExp(`^/(${LOCALE_ALTERNATION})(?=/|$)`);
const ORG_PATH_RE = new RegExp(`^(?:/(?:${LOCALE_ALTERNATION}))?/org/([^/]+)`);

/** Sépare le préfixe locale du reste du chemin (`/en/login` → en + `/login`). */
function stripLocale(pathname: string): { locale: Locale; pathname: string } {
  const m = pathname.match(LOCALE_PREFIX_RE);
  if (m) {
    const stripped = pathname.slice(m[0].length) || "/";
    return { locale: m[1] as Locale, pathname: stripped };
  }
  return { locale: DEFAULT_LOCALE, pathname };
}

export { isMediaReadPath };

/** Page accessible sans session (chemin SANS préfixe locale). */
export function isPublicPagePath(pathnameWithoutLocale: string): boolean {
  return [...publicPaths, ...getHttpHooks().publicPaths].some((p) => pathnameWithoutLocale === p || pathnameWithoutLocale.startsWith(p + "/"));
}

const AUTOMATION_HOOK_RE = /^\/api\/automations\/hook\/[^/]+$/;

/** Webhook entrant des automatismes : route publique, authentifiée par jeton dans le handler. */
export function isPublicAutomationHookPath(pathname: string): boolean {
  return AUTOMATION_HOOK_RE.test(pathname);
}

/** Routes planifiées : sans session, authentifiées par CRON_SECRET dans le handler (fail-closed). */
export function isPublicCronPath(pathname: string): boolean {
  return (
    pathname === "/api/cron/kb-index" ||
    pathname === "/api/cron/media-purge" ||
    pathname === "/api/cron/media-usages" ||
    pathname === "/api/cron/row-history-purge" ||
    pathname === "/api/calendar-reminders"
  );
}

const intlMiddleware = createIntlMiddleware(routing);

function resolveOrgSlug(req: NextRequest): string {
  const host = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  // Mode hote fourni par un module (neutre : aucun).
  const fromHook = getHttpHooks().resolveOrgSlug(host, pathname);
  if (fromHook) return fromHook;

  // Mode path : /org/acme/... ou /{locale}/org/acme/... → slug "acme"
  const pathMatch = pathname.match(ORG_PATH_RE);
  if (pathMatch) return pathMatch[1];

  return "default";
}

// Hash SHA-256 du script inline de détection du thème (src/app/[locale]/layout.tsx, <head>).
// `strict-dynamic` ignore 'self'/host-source : un <script> inline non-noncé serait
// bloqué par le navigateur. Ce script statique ne reçoit pas le nonce de Next.js
// (réservé aux <script> générés par Next), et le noncer manuellement imposerait de
// rendre le layout dynamique (headers()), donc tout le site dynamique. On l'autorise
// par son hash à la place. ⚠ Si le script de layout.tsx change, régénérer ce hash —
// le test src/__tests__/csp-theme-hash.test.ts échoue sinon (anti-dérive).
const THEME_SCRIPT_HASH = "'sha256-0bl3qfy2TVEcSqWbnPTaSfbqpT2811uzf4Q5tEMNsk0='";

// CSP dynamique avec nonce — sources configurables via env vars.
// L'URL LiveKit n'est PAS lue ici : elle vient de la config admin (DB) via
// getLiveKitUrlForCsp(), résolue par requête dans addCspHeaders (proxy Node).
const s3PublicUrl = process.env.S3_PUBLIC_URL || "http://localhost:3900";
const wsUrl = process.env.WS_URL || "";

export function buildCsp(nonce: string, livekitUrl: string): string {
  // Extract LiveKit host for CSP connect-src (ws://host → wss://host)
  let livekitCsp = "";
  if (livekitUrl) {
    try {
      const parsed = new URL(livekitUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:"));
      livekitCsp = ` wss://${parsed.host} ws://${parsed.host} https://${parsed.host} http://${parsed.host}`;
    } catch {
      // Invalid URL — skip
    }
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' ${THEME_SCRIPT_HASH} 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    // Studio design : feuilles de style des polices Google Fonts + Fontshare.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com",
    `img-src 'self' data: blob: ${s3PublicUrl} https://*.tile.openstreetmap.org https://i.pravatar.cc https://*.gravatar.com https://images.unsplash.com`,
    // Studio design : fichiers de polices Google Fonts (gstatic) + Fontshare (cdn).
    "font-src 'self' data: https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    `connect-src 'self' ${s3PublicUrl}${wsUrl ? ` ${wsUrl}` : ""}${livekitCsp} https://nominatim.openstreetmap.org${process.env.NODE_ENV === "development" ? " ws://localhost:* wss://localhost:*" : ""}`,
    `frame-src 'self' https://docs.google.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.dailymotion.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Branche 1 : routes système, jamais préfixées par une locale ──────────
  // (API, service worker, well-known, messages). Logique d'avant l'i18n.
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/serwist/") ||
    pathname.startsWith("/.well-known/") ||
    pathname === "/sw.js" ||
    pathname === "/sw.js.map" ||
    pathname.startsWith("/swe-worker-") ||
    pathname.startsWith("/messages/")
  ) {
    return handleSystem(req);
  }

  // ── Branche 2 : délégation à next-intl (redirect / canonisation locale) ──
  // localePrefix "always" : toute URL de page sans préfixe reçoit un 307 vers
  // /{locale}/... — on le retourne tel quel, sans CSP ni auth (la requête
  // re-rentrera dans le middleware avec son préfixe).
  const intlResponse = intlMiddleware(req);
  if (intlResponse && intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  // ── Branche 3 : pages HTML préfixées — auth + CSP sur le chemin dé-localisé.
  const { locale, pathname: pathnameWithoutLocale } = stripLocale(pathname);
  return handlePage(req, locale, pathnameWithoutLocale, intlResponse);
}

/** Routes système (API, SW, well-known) : comportement pré-i18n, inchangé. */
async function handleSystem(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  // Setup wizard — accessible sans authentification
  if (pathname.startsWith("/api/setup/")) {
    return await getHttpHooks().syncOrgCookie(req, await addCspHeaders(req));
  }

  // Auth NextAuth (signin/signout/callbacks)
  if (pathname.startsWith("/api/auth/")) {
    return await getHttpHooks().syncOrgCookie(req, await addCspHeaders(req));
  }

  // Healthchecks et ping réseau
  if (pathname === "/api/health" || pathname === "/api/ping") {
    return NextResponse.next();
  }

  // Webhook entrant des automatismes (Tally, etc.) : appelé par un tiers sans
  // session. Le handler authentifie lui-même par jeton (48 hex) et secret.
  // Motif volontairement strict : un seul segment de jeton, rien d'autre.
  if (isPublicAutomationHookPath(pathname)) {
    return NextResponse.next();
  }

  // Routes planifiées : appelées par un cron sans session. Le handler exige
  // CRON_SECRET (401 si absent ou incorrect).
  if (isPublicCronPath(pathname)) {
    return NextResponse.next();
  }

  // API v1 : l'authentification se fait via Bearer token dans la route handler
  if (pathname.startsWith("/api/v1/")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-org-slug", resolveOrgSlug(req));
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // API publique : accès sans authentification (partage externe)
  if (pathname.startsWith("/api/public/")) {
    return await addCspHeaders(req);
  }

  // CalDAV : authentification gérée dans le handler (Basic Auth / Bearer)
  if (pathname.startsWith("/api/caldav/") || pathname.startsWith("/.well-known/caldav")) {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-org-slug", resolveOrgSlug(req));
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Service worker, messages, autres well-known : passage direct
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Runtime de présentation : artefact HTML autoportant (Bento vendorisé) servi
  // dans une iframe en origine opaque. La politique verrouillée des API internes
  // interdirait ses scripts inline (`default-src 'none'`) et son encadrement
  // (`frame-ancestors 'none'`), alors que c'est précisément un document actif.
  // La route pose donc elle-même une CSP dédiée, bien plus étroite sur le réseau
  // (`connect-src 'none'`), et le middleware se borne à exiger la session.
  if (pathname.startsWith("/api/presentations/runtime/")) {
    return await checkAuth(req, DEFAULT_LOCALE);
  }

  // APIs internes : auth requise. Pas de CSP à nonce (rien d'HTML n'est rendu
  // ici), mais une politique VERROUILLÉE (constat INJ-15, audit du 2026-08-19).
  // Ces routes ne recevaient aucune politique : une réponse ouverte en
  // navigation de premier niveau (image du studio, fichier, contenu relayé)
  // s'exécutait donc sur l'origine de l'application. Inerte sur du JSON, inerte
  // sur une image chargée en `<img>` (la CSP d'une sous-ressource n'est pas
  // appliquée), inerte sur un flux : elle ne mord que sur les documents.
  return addApiSecurityHeaders(await checkAuth(req, DEFAULT_LOCALE), pathname);
}

/**
 * Politique verrouillée des réponses d'API internes. Volontairement
 * indépendante du nonce : aucune réponse d'API n'a de script légitime.
 *
 * Familles EXCLUES, traitées par des branches antérieures de `handleSystem` :
 *  - `/api/auth/`, `/api/setup/`, `/api/public/` rendent ou alimentent des
 *    pages HTML et reçoivent la CSP à nonce ;
 *  - `/api/health`, `/api/ping` sont des sondes sans session ;
 *  - `/api/v1/` (jeton Bearer) et `/api/caldav/` servent des clients non
 *    navigateurs, où une politique de navigateur n'apporte rien et où un
 *    en-tête inattendu pourrait dérouter un agent CalDAV.
 *  - `/api/presentations/runtime/` sert un document HTML actif volontairement,
 *    et pose sa propre politique, plus stricte sur le réseau.
 *
 * `/api/attachments/<clé>` est l'alias permanent d'un média : même pipeline que `/api/media/<id>` quand une ligne media existe, jamais encadrable.
 *
 * La directive `sandbox` n'est délibérément PAS posée ici. Une famille de
 * routes renvoie des téléchargements (`/api/attachments/[...key]`,
 * `/api/media/[id]`, `/api/voice-notes/[id]/audio`, les exports CSV/XLSX de
 * bases, l'export ICS des calendriers, l'export des salles, l'export des journaux IA) et les
 * navigateurs traitent mal un téléchargement issu d'une navigation mise en bac
 * à sable. `default-src 'none'` interdit déjà tout script, ce qui suffit à
 * neutraliser un document actif ; `sandbox` n'ajouterait qu'une origine opaque
 * pour un risque de régression fonctionnelle réel. Les deux routes d'images,
 * qui maîtrisent leur propre réponse, la posent en revanche.
 */
export function addApiSecurityHeaders(res: NextResponse, pathname = ""): NextResponse {
  // Lecture d'un média : encadrable par la même origine seulement (aperçu PDF).
  const frameAncestors = isMediaReadPath(pathname) ? "'self'" : "'none'";
  res.headers.set(
    "Content-Security-Policy",
    `default-src 'none'; frame-ancestors ${frameAncestors}; base-uri 'none'; form-action 'none'`
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

/** Pages HTML : publicPaths/auth évalués sur le chemin SANS préfixe locale. */
async function handlePage(
  req: NextRequest,
  locale: Locale,
  pathnameWithoutLocale: string,
  intlResponse: NextResponse | undefined,
): Promise<NextResponse> {
  // Setup wizard — accessible sans authentification
  if (pathnameWithoutLocale === "/setup" || pathnameWithoutLocale.startsWith("/setup/")) {
    return await getHttpHooks().syncOrgCookie(req, await addCspHeaders(req, intlResponse));
  }

  // Routes publiques
  if (isPublicPagePath(pathnameWithoutLocale)) {
    return await getHttpHooks().syncOrgCookie(req, await addCspHeaders(req, intlResponse));
  }

  // Vérifier l'authentification + ajouter CSP avec nonce
  const authResult = await checkAuth(req, locale, pathnameWithoutLocale);
  if (authResult.status === 307 || authResult.status === 302) return authResult;

  return await getHttpHooks().syncOrgCookie(req, await addCspHeaders(req, intlResponse));
}

/**
 * Vérifie le JWT et redirige vers /{locale}/login si absent.
 * `pathnameWithoutLocale` (pages uniquement) sert au test force-password-change ;
 * le callbackUrl conserve le chemin COMPLET (préfixe locale inclus).
 */
async function checkAuth(
  req: NextRequest,
  locale: Locale,
  pathnameWithoutLocale?: string,
): Promise<NextResponse> {
  const secureCookie = process.env.NODE_ENV === "production";
  const cookieName = secureCookie
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET, cookieName, salt: cookieName });

  if (!token) {
    const loginUrl = new URL(`/${locale}/login`, req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  const forceResetPath = "/force-password-change";
  const isApiAuth = req.nextUrl.pathname.startsWith("/api/auth");
  const effectivePath = pathnameWithoutLocale ?? req.nextUrl.pathname;
  if (
    (token as { mustResetPassword?: boolean }).mustResetPassword === true &&
    effectivePath !== forceResetPath &&
    !isApiAuth
  ) {
    return NextResponse.redirect(new URL(`/${locale}${forceResetPath}`, req.url));
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-org-slug", resolveOrgSlug(req));
  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Génère un nonce, l'injecte dans les headers de requête (pour que Next.js
 * l'applique automatiquement aux <script>) ET dans les headers de réponse
 * (pour le navigateur).
 *
 * `intlResponse` (réponse non-redirect de next-intl) : ses headers de requête
 * (ex. x-next-intl-locale) et de réponse (ex. Link alternates, Set-Cookie
 * NEXT_LOCALE) sont reportés sur la réponse finale — pattern de composition
 * next-intl + auth middleware.
 */
async function addCspHeaders(req: NextRequest, intlResponse?: NextResponse): Promise<NextResponse> {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const livekitUrl = await getLiveKitUrlForCsp();
  const csp = buildCsp(nonce, livekitUrl);

  // Propager le CSP dans les headers de requête pour que Next.js extraie le nonce
  // et l'injecte dans ses <script> tags (App Router, getScriptNonceFromHeader)
  const requestHeaders = new Headers(req.headers);

  // Reporter les overrides de headers de REQUÊTE posés par next-intl
  // (NextResponse.next({request}) les encode en x-middleware-request-*).
  if (intlResponse) {
    const override = intlResponse.headers.get("x-middleware-override-headers");
    if (override) {
      for (const name of override.split(",")) {
        const key = name.trim();
        const value = intlResponse.headers.get(`x-middleware-request-${key}`);
        if (key && value !== null) requestHeaders.set(key, value);
      }
    }
  }

  requestHeaders.set("Content-Security-Policy", csp);
  requestHeaders.set("x-org-slug", resolveOrgSlug(req));

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Reporter les headers de RÉPONSE de next-intl (Link alternates, cookies…),
  // hors mécanique interne x-middleware-*. Rewrite éventuel reporté aussi
  // (défensif : avec localePrefix "always", next-intl ne rewrite normalement pas).
  if (intlResponse) {
    intlResponse.headers.forEach((value, key) => {
      if (key.startsWith("x-middleware-")) return;
      if (key === "set-cookie") {
        response.headers.append(key, value);
      } else {
        response.headers.set(key, value);
      }
    });
    const rewrite = intlResponse.headers.get("x-middleware-rewrite");
    if (rewrite) {
      response.headers.set("x-middleware-rewrite", rewrite);
      response.headers.delete("x-middleware-next");
    }
  }

  // Aussi sur la réponse pour le navigateur
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("x-csp-nonce", nonce);
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon-32\\.png|icon\\.svg|serwist/|sw\\.js|sw\\.js\\.map|swe-worker-.*\\.js|manifest\\.json|messages/|mascotte\\.svg|logotype-clair\\.svg|logotype-sombre\\.svg|app-icon-192\\.png|app-icon-512\\.png|og-image\\.png|excalidraw-libraries/|templates/).*)",
  ],
};
