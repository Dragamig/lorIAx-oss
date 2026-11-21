import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Premier test de chaque route : import à froid de gros modules, > 5 s sous charge.
    testTimeout: 30000,
    globals: true,
    environment: "node",
    exclude: ["e2e/**", "node_modules/**", ".next/**", "video/**", "tmp/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` n'est pas une dependance runtime (le vrai package leve une
      // exception hors condition d'export `react-server`, ce qui casserait les
      // tests Node). On l'aliase vers le meme stub vide que le bundle serveur
      // prod (cf. esbuild-stubs/server-only.js + Dockerfile --alias:server-only).
      // NB : volontairement PAS dans tsconfig paths — sinon le garde-fou cote
      // bundle client Next.js serait neutralise.
      "server-only": path.resolve(__dirname, "./esbuild-stubs/server-only.js"),
    },
  },
});
