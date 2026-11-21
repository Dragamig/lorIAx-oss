// Stub vide pour le package `server-only`, utilisé UNIQUEMENT par le bundle du
// serveur custom (server.ts → esbuild, voir Dockerfile `--alias:server-only`).
//
// Pourquoi : esbuild bundle server.ts avec `--packages=external`, donc tout code
// local inliné qui fait `import "server-only"` (ex. url-validator-server.ts via
// la chaîne chat/automations) émet un `require("server-only")` externe. Or ce
// package n'est pas une dépendance runtime → MODULE_NOT_FOUND au démarrage.
//
// Le vrai package `server-only` lèverait de toute façon une exception sous Node
// pur (hors condition d'export `react-server`). On l'aliase donc vers ce module
// vide : le garde-fou reste pleinement actif côté bundle client Next.js (qui,
// lui, résout le vrai package avec la condition `react-server`).
module.exports = {};
