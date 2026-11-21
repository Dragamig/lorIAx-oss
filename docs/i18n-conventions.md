# Conventions i18n — LorIAx App

Plomberie : [next-intl](https://next-intl.dev) v4 (`src/i18n/`, `messages/`, plugin dans `next.config.ts`).

## Locales

7 locales, préfixe d'URL obligatoire (`localePrefix: "always"`) :

| Code | Langue | Remarques |
|------|--------|-----------|
| `fr` | Français | **Locale par défaut**, langue source de toutes les clés |
| `en` | English | **Langue canari** : relue systématiquement avec fr ; si une clé sonne faux en anglais, la structure de la clé est probablement mauvaise |
| `es` | Español | |
| `de` | Deutsch | Vouvoiement formel (*Sie*) |
| `ja` | 日本語 | Style poli です・ます |
| `zh` | 简体中文 | Chinois simplifié |
| `br` | Brezhoneg | **Beta** (affiché « Brezhoneg (beta) »), breton standard peurunvan |

Les 7 fichiers `messages/<locale>.json` doivent avoir des jeux de clés **strictement identiques** — vérifié par `npm run i18n:check` (parité des clés, parité des placeholders ICU, aucune valeur vide).

## Nommage des clés

- Namespaces et clés en **camelCase**, hiérarchie `ns.page.element[.state]` :
  - `auth.login.submit`, `auth.login.submitting`, `spaces.createDialog.title`
- Le namespace de premier niveau correspond au domaine métier (`common`, `auth`, `spaces`, `editor`, …), pas à un composant technique.
- `common` est réservé aux libellés réellement transverses (boutons génériques, états de chargement) — en cas de doute, mettre la clé dans le namespace métier.

## ICU, pas de concaténation

- **Jamais de concaténation de chaînes** pour composer une phrase : utiliser les placeholders ICU.
  - ✅ `"greeting": "Bonjour {name}"` → `t("greeting", { name })`
  - ❌ `t("hello") + " " + name`
- Pluriels et sélections via la syntaxe ICU : `"{count, plural, =0 {aucun document} one {# document} other {# documents}}"`.
- Les placeholders doivent être identiques dans toutes les locales (contrôlé par `i18n:check`).

## Toasts

Les messages de toast vivent dans le **namespace métier** concerné, sous-clé `toasts`, suffixes `Success` / `Error` :

```json
"spaces": {
  "toasts": {
    "createSuccess": "Espace créé",
    "createError": "Erreur lors de la création",
    "deleteSuccess": "Espace supprimé"
  }
}
```

## Accessibilité

Les libellés destinés aux attributs `aria-*` portent le suffixe `…Aria` :

```json
"closeAria": "Fermer la fenêtre",
"searchInputAria": "Champ de recherche"
```

## Modules non-React (lib/, services, helpers)

Un module hors React n'importe **jamais** `useTranslations`. Par ordre de préférence :

1. **Remonter la chaîne au composant appelant** : le module retourne des données, le composant React traduit.
2. **Exporter des clés** : le module retourne des clés i18n (ex. `"errors.networkTimeout"`), traduites par l'appelant.
3. **Factory recevant `t`** : en dernier recours, le module expose une factory qui reçoit la fonction de traduction (`createFormatter(t)`).

## Outillage

| Commande | Rôle |
|----------|------|
| `npm run i18n:check` | Parité clés + placeholders ICU + valeurs vides sur les 7 locales (CI-friendly, exit ≠ 0 en cas d'écart) |
| `npm run i18n:find-fr` | Détection heuristique de chaînes FR codées en dur dans `.ts`/`.tsx` (accepte des chemins en arguments ; `// i18n-ignore` pour exclure une ligne) |
| `npm run i18n:translate` | Émet en batchs JSON les clés présentes dans `fr.json` mais manquantes/vides dans les autres locales (`--locale=xx`, `--batch-size=n`) |

## Workflow d'ajout d'une clé

1. Ajouter la clé et sa valeur française dans `messages/fr.json`.
2. Traduire dans les 6 autres locales (au besoin via `npm run i18n:translate` pour lister les manques).
3. `npm run i18n:check` doit être vert avant commit.
