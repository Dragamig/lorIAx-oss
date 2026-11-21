import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import {
  Plus_Jakarta_Sans,
  Source_Serif_4,
  JetBrains_Mono,
  EB_Garamond,
} from "next/font/google";
import { AppToaster } from "@/components/app-toaster";
import { SerwistProvider } from "../serwist";
import { DevSwCleanup } from "@/components/dev-sw-cleanup";
import { routing } from "@/i18n/routing";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  viewportFit: "cover",
  // a11y : autoriser le zoom utilisateur jusqu'a 5x (WCAG 1.4.4). maximumScale:1
  // bloquait le pincer-zoomer sur mobile pour les malvoyants.
  maximumScale: 5,
};

export const metadata: Metadata = {
  title: "LorIAx — Gestion de connaissances",
  description:
    "Plateforme de gestion de connaissances auto-hebergee pour organismes multi-services",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/app-icon-192.png", sizes: "192x192" }],
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "LorIAx — Gestion de connaissances",
    description:
      "Plateforme de gestion de connaissances auto-hebergee pour organismes multi-services",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  // Active le rendu statique par locale (next-intl App Router pattern).
  setRequestLocale(locale);

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${ebGaramond.variable}`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            // ARCH-07 — Script inline de détection du thème pour éviter le flash.
            // Le catch vide est intentionnel : localStorage lance en navigation privée
            // ou quand le stockage est désactivé. Pas de fallback nécessaire (thème clair par défaut).
            // ⚠ CSP : ce script est autorisé par hash SHA-256 (THEME_SCRIPT_HASH dans
            // src/proxy.ts) — toute modification du texte casse le hash
            // (garde-fou : src/__tests__/csp-theme-hash.test.ts).
            __html: `(function(){try{var t=localStorage.getItem("loriax-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){/* localStorage indisponible, thème clair par défaut */}})()`,
          }}
        />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider>
          <SerwistProvider
            swUrl="/serwist/sw.js"
            disable={process.env.NODE_ENV !== "production"}
          >
            <DevSwCleanup />
            {children}
          </SerwistProvider>
          <AppToaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
