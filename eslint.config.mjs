import coreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals.map((config) => {
    if (config.settings?.react) {
      return {
        ...config,
        settings: {
          ...config.settings,
          react: { version: "19" },
        },
      };
    }
    return config;
  }),
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "server.demo.js",
      "*.demo.js",
    ],
  },
  {
    // React Compiler ESLint rules — downgraded to warnings (not yet enforced)
    // These rules enforce React Compiler (Forget) compatibility patterns.
    // Tracked as warnings until the codebase is ready for full React Compiler adoption.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    // @next/next/no-html-link-for-pages — structurellement faux-positif depuis
    // le segment racine dynamique [locale] : il matche N'IMPORTE QUEL premier
    // segment d'URL, donc la règle flagge tout <a href="/..."> interne, y
    // compris les ancres légitimes (téléchargements /api/..., flux iCal…).
    // Downgrade en "warn" ; la migration des vrais liens de pages vers le
    // Link de @/i18n/routing est portée par la règle no-restricted-imports
    // ci-dessous (Stage 1).
    rules: {
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
  {
    // i18n (next-intl) — la navigation doit passer par @/i18n/routing pour que
    // le préfixe locale soit appliqué. Réglé en "warn" (Stage 0) : les pages
    // déplacées sous [locale]/ importent encore massivement next/link et
    // next/navigation ; le Stage 1 réécrira ces surfaces et passera la règle
    // en "error" au fur et à mesure. Les exports non-navigation de
    // next/navigation (useSearchParams, notFound, useParams…) restent permis.
    files: ["src/app/\\[locale\\]/**", "src/components/**"],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Utiliser `Link` de @/i18n/routing (next-intl) pour des liens localisés.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "redirect", "permanentRedirect", "Link"],
              message:
                "Utiliser les équivalents de @/i18n/routing (next-intl) pour une navigation localisée.",
            },
          ],
        },
      ],
    },
  },
  {
    // i18n (Stage 1.1) — surface auth migrée : règle passée en "error" pour
    // garantir qu'aucun import de navigation non-localisé ne réapparaît dans
    // les pages et composants auth.
    files: ["src/app/\\[locale\\]/(auth)/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Utiliser `Link` de @/i18n/routing (next-intl) pour des liens localisés.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "redirect", "permanentRedirect", "Link"],
              message:
                "Utiliser les équivalents de @/i18n/routing (next-intl) pour une navigation localisée.",
            },
          ],
        },
      ],
    },
  },
  {
    // i18n (Stage 1.2) — surface setup migrée : règle passée en "error" pour
    // garantir qu'aucun import de navigation non-localisé ne réapparaît dans
    // les pages et composants setup.
    files: ["src/app/\\[locale\\]/(setup)/**", "src/components/setup/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Utiliser `Link` de @/i18n/routing (next-intl) pour des liens localisés.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "redirect", "permanentRedirect", "Link"],
              message:
                "Utiliser les équivalents de @/i18n/routing (next-intl) pour une navigation localisée.",
            },
          ],
        },
      ],
    },
  },
  {
    // i18n (Stage 1.3) — shell surface migrated: rule promoted to "error" to
    // prevent non-localised navigation imports from reappearing in sidebar
    // and layout shell components.
    files: [
      "src/components/sidebar/**",
      "src/components/layout/**",
      "src/components/LocaleSwitcher.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Utiliser `Link` de @/i18n/routing (next-intl) pour des liens localisés.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "redirect", "permanentRedirect", "Link"],
              message:
                "Utiliser les équivalents de @/i18n/routing (next-intl) pour une navigation localisée.",
            },
          ],
        },
      ],
    },
  },
  {
    // i18n (Stage 2.1) — hub + visualisations surface migrated: rule promoted to
    // "error" to prevent non-localised navigation imports from reappearing in
    // home, search, AI, graph, tasks, new, dashboards, notifications, labels, chat.
    // Note: `redirect` is excluded — server components use next/navigation redirect for
    // auth guards (middleware handles locale prefixing), consistent with the whole codebase.
    files: [
      "src/app/\\[locale\\]/(app)/page.tsx",
      "src/app/\\[locale\\]/(app)/search/**",
      "src/app/\\[locale\\]/(app)/ai/**",
      "src/app/\\[locale\\]/(app)/graph/**",
      "src/app/\\[locale\\]/(app)/tasks/**",
      "src/app/\\[locale\\]/(app)/new/**",
      "src/app/\\[locale\\]/(app)/dashboards/**",
      "src/components/graph/**",
      "src/components/notifications/**",
      "src/components/labels/**",
      "src/components/chat/**",
      "src/app/\\[locale\\]/(app)/s/**",
      "src/components/document/**",
      "src/components/document-move-dialog.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Utiliser `Link` de @/i18n/routing (next-intl) pour des liens localisés.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "permanentRedirect", "Link"],
              message:
                "Utiliser les équivalents de @/i18n/routing (next-intl) pour une navigation localisée.",
            },
          ],
        },
      ],
    },
  },
  {
    // i18n (Stage 2.3) — calendar + gantt surface migrated: rule promoted to
    // "error" to prevent non-localised navigation imports from reappearing in
    // calendar page and calendar/gantt components.
    files: [
      "src/app/\\[locale\\]/(app)/calendar/**",
      "src/components/calendar/**",
      "src/components/gantt/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Utiliser `Link` de @/i18n/routing (next-intl) pour des liens localisés.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "permanentRedirect", "Link"],
              message:
                "Utiliser les équivalents de @/i18n/routing (next-intl) pour une navigation localisée.",
            },
          ],
        },
      ],
    },
  },
  {
    // i18n (Stage 2.4) — meet + organisation + meeting-rooms surface migrated: rule promoted to
    // "error" to prevent non-localised navigation imports from reappearing in
    // meet pages, organisation pages, and meeting-rooms components.
    // Note: `redirect` is excluded — server components use next/navigation redirect for
    // auth guards (middleware handles locale prefixing), consistent with the whole codebase.
    files: [
      "src/app/\\[locale\\]/(app)/meet/**",
      "src/app/\\[locale\\]/(app)/organisation/**",
      "src/components/meeting-rooms/**",
      "src/components/meet/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "next/link",
              importNames: ["default"],
              message:
                "Utiliser `Link` de @/i18n/routing (next-intl) pour des liens localisés.",
            },
            {
              name: "next/navigation",
              importNames: ["useRouter", "usePathname", "permanentRedirect", "Link"],
              message:
                "Utiliser les équivalents de @/i18n/routing (next-intl) pour une navigation localisée.",
            },
          ],
        },
      ],
    },
  },
  {
    // Variables and parameters prefixed with _ are intentionally unused.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default eslintConfig;
