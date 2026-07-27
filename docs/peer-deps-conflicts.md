# Audit des conflits peer dependencies (LorIAx)

## Synthèse

Plusieurs conflits de peer dependencies sont détectés avec `npm install --legacy-peer-deps=false`. Le dépôt est configuré avec `legacy-peer-deps=true` (`.npmrc`), ce qui permet l'installation et le fonctionnement normal de toutes les commandes, y compris `npm run lint`.

## Conflits détectés

### 1. Nodemailer (@auth/core)

**Conflit :**
- Installé : `nodemailer@8.0.4` (requis par le projet)
- Attendu par : `@auth/core@0.41.1` → `nodemailer@^7.0.7` (peerOptional)

**Impact :** FAIBLE. Le projet utilise nodemailer 8.x, plus récent. @auth/core accepte aussi 7.x, compatible avec les APIs principales.

**État :** Ignoré (override forcé)

---

### 2. React + React-DOM (@radix-ui/react-tabs de Excalidraw)

**Conflit :**
- Installés : `react@19.2.4`, `react-dom@19.2.4` (requis par le projet)
- Attendus par : `@radix-ui/react-tabs@1.0.2` → `react@^16.8 || ^17.0 || ^18.0`

**Impact :** MOYEN. React 19 n'est pas officiellement supporté par @radix-ui/react-tabs v1. Excalidraw dépend d'une version de Radix UI ancienne.

**Référence :** Excalidraw v0.18.0 contient Radix UI 1.x, antérieur au support React 19.

**État :** Ignoré (override forcé). À surveiller lors de mises à jour d'Excalidraw.

---

### 3. ESLint v10 (incompatibilité avec plugins ESLint)

**Conflits :**
- Installé : `eslint@10.0.3` (requis par le projet)
- Attendus par :
  - `eslint-plugin-import@2.32.0` → `eslint@^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0 || ^8 || ^9`
  - `eslint-plugin-jsx-a11y@6.10.2` → `eslint@^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9`
  - `eslint-plugin-react@7.37.5` → `eslint@^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9.7`
  - `eslint-plugin-react-hooks@7.0.1` → `eslint@^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0-0 || ^9.0.0`

**Impact :** FAIBLE avec la configuration actuelle. Les plugins ESLint n'ont pas déclaré la compatibilité ESLint 10, ce qui bloquait `npm run lint` en installation stricte (erreur circulaire, voir [eslint.config.mjs](../eslint.config.mjs)).

**État :** RÉSOLU en pratique. Avec `legacy-peer-deps=true` (défini dans `.npmrc`), `npm run lint` s'exécute normalement (vérifié en 2026-07). Le conflit disparaîtra définitivement quand les plugins déclareront ESLint 10 dans leurs peer dependencies.

---

## Plan d'action

| Priorité | Conflit | Action | Sprint |
|----------|---------|--------|--------|
| FAIBLE | ESLint 10 + plugins | Surveiller la déclaration ESLint 10 dans les plugins (contourné par `legacy-peer-deps`) | Surveillance |
| MOYEN | React 19 + Excalidraw | Upgrader Excalidraw dès version supportant React 19 | Futur |
| FAIBLE | Nodemailer 8 vs 7 | Surveiller @auth/core releases | Surveillance |

## Configuration actuelle

- `legacy-peer-deps=true` en place (`.npmrc`)
- Les conflits sont ignorés mais génèrent des avertissements
- `npm run lint`, `npm test` et `npm run build` fonctionnent avec cette configuration

## Références

- **ESLint Issue :** https://github.com/eslint/eslint/issues/18301 (ESLint v10 peer deps)
- **Excalidraw :** https://github.com/excalidraw/excalidraw/releases
- **NextAuth :** https://github.com/nextauthjs/next-auth/releases

---

**Audit :** Sprint 10 qualité & sécurité (2026-04-05). **Mise à jour :** 2026-07-27, état du lint revérifié sur l'édition open source.
