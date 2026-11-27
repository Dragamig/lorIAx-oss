import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import createNextIntlPlugin from "next-intl/plugin";
import { frameHeaderRules } from "./src/lib/media/frame-policy";
import { legacyStudioImageRedirect } from "./src/lib/media/legacy-redirects";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Resolve __dirname for ESM compatibility (Node 18)
const __configDir = path.dirname(fileURLToPath(import.meta.url));

// Version applicative exposée au client (note de version affichée près du logo).
const appVersion = createRequire(import.meta.url)("./package.json").version as string;

// CSP désormais gérée dynamiquement par le middleware (nonce-based)
// Les headers statiques ci-dessous sont des fallbacks pour les assets statiques

const s3PublicUrl = process.env.S3_PUBLIC_URL || "http://localhost:3900";
const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Le runtime de présentation vit dans `vendor/`, hors de `public/` : la CSP
   * globale tuerait ses scripts inline s'il était servi en fichier statique. Il
   * est donc lu sur disque par sa route de service, et la trace de sortie de
   * Next ne le voit pas (aucun `import` ne le mentionne). Sans cette
   * déclaration, le module fonctionne en développement et rend 404 en image
   * Docker.
   */
  outputFileTracingIncludes: {
    "/api/presentations/runtime/[version]": ["./vendor/bento/**"],
    // Worker de miniature PDF : JS pur chargé par `new Worker(chemin)`, invisible
    // pour la trace (aucun `import`). Sans cette ligne : pas de miniature en Docker.
    "/api/**": [
      "./src/lib/media/pdf-thumbnail-worker.mjs",
      "./src/lib/media/ai/pdf-text-worker.mjs",
    ],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  transpilePackages: ["@excalidraw/excalidraw"],
  /**
   * Redirections HTTP, appliquées avant le middleware et avant le rendu.
   *
   * L'ancienne page « Services » est fusionnée dans « Modules et services ».
   * La redirection est déclarée ici plutôt que rendue par une page : une
   * redirection émise depuis un composant serveur n'aboutissait pas (la page
   * s'exécutait, l'exception était bien levée, mais le navigateur restait sur
   * place avec une page vide). Une règle HTTP ne dépend ni du rendu ni du
   * streaming.
   *
   * Le motif de locale est énuméré, jamais `:locale` seul : ce joker
   * capturerait aussi `/api/admin/services`, et détournerait la route de sonde
   * de santé vers une adresse inexistante.
   *
   * Temporaire (307) et non permanent : un 308 serait mis en cache durablement
   * par les navigateurs, donc irréversible côté postes clients si la route
   * devait un jour reprendre du service.
   */
  async redirects() {
    return [
      legacyStudioImageRedirect,
      {
        source: "/admin/services",
        destination: "/admin/modules",
        permanent: false,
      },
      {
        source: "/:locale(fr|en|es|de|ja|zh|br)/admin/services",
        destination: "/:locale/admin/modules",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: `camera=(self), microphone=(self), geolocation=()`,
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          // CSP dynamique avec nonce gérée par le middleware (src/middleware.ts)
        ],
      },
      // X-Frame-Options : DENY partout, SAMEORIGIN pour la lecture d'un média (aperçu PDF).
      ...frameHeaderRules(),
      {
        /**
         * Le runtime de présentation est fait pour être encadré par nos propres
         * pages. Le X-Frame-Options DENY de la règle générale l'interdirait :
         * la spécification veut que `frame-ancestors` prime quand les deux sont
         * posés, mais on ne s'appuie pas sur une règle de préséance pour un
         * refus de rendu. Déclaré après la règle générale, qu'il remplace.
         */
        source: "/api/presentations/runtime/:version",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
  images: {
    localPatterns: [
      { pathname: "/api/user/avatar", search: "**" },
      { pathname: "/favicon-32.png" },
      { pathname: "/favicon*.png" },
    ],
    remotePatterns: (() => {
      const patterns: Array<{ protocol: "http" | "https"; hostname: string; port?: string; pathname?: string }> = [
        // Avatars externes (pravatar, gravatar)
        { protocol: "https", hostname: "i.pravatar.cc" },
        { protocol: "https", hostname: "*.gravatar.com" },
      ];
      try {
        const url = new URL(s3PublicUrl);
        patterns.push({
          protocol: url.protocol.replace(":", "") as "http" | "https",
          hostname: url.hostname,
          port: url.port || undefined,
          pathname: "/loriax-files/**",
        });
      } catch {
        patterns.push({
          protocol: "http",
          hostname: "localhost",
          port: "9000",
          pathname: "/loriax-files/**",
        });
      }
      return patterns;
    })(),
  },
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "re2", "metascraper", "metascraper-description", "metascraper-image", "metascraper-title", "metascraper-url", "ldapjs", "pino", "thread-stream", "ioredis", "esbuild-wasm", "yjs", "y-protocols", "@hocuspocus/server", "@hocuspocus/extension-database"],
  turbopack: {
    root: __configDir,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
    turbopackFileSystemCacheForDev: true,
  },
};

// PERF-13 — Bundle analyzer (lancé avec ANALYZE=true npm run build)
// Chargement conditionnel : @next/bundle-analyzer reste en devDependencies
// et n'est requis qu'en build local d'analyse.
const analyzer: (cfg: NextConfig) => NextConfig =
  process.env.ANALYZE === "true"
    ? createRequire(import.meta.url)("@next/bundle-analyzer")({ enabled: true })
    : (cfg) => cfg;
export default withSerwist(withNextIntl(analyzer(nextConfig)));
