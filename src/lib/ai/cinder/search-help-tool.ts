import { tool } from "ai";
import { z } from "zod";
import { searchKb } from "@/lib/kb/kb";
import { sanitizeRagContent } from "@/lib/ai/sanitize-content";

const SEARCH_HELP_LIMIT = 5;

/**
 * Outil de recherche dans la documentation produit. L'identité de l'utilisateur
 * est fermée par closure : le modèle ne la fournit jamais.
 */
export function createSearchHelpTool(userId: string) {
  return tool({
    description:
      "Recherche dans la documentation officielle de LorIAx (menus, écrans, réglages, fonctionnement). À utiliser pour toute question sur l'utilisation ou la configuration de LorIAx.",
    inputSchema: z.object({ query: z.string().min(3).max(300) }),
    execute: async ({ query }) => {
      try {
        const hits = await searchKb(query, SEARCH_HELP_LIMIT, userId);
        return {
          results: hits.slice(0, SEARCH_HELP_LIMIT).map((h) => ({
            title: h.title,
            source: h.source,
            text: sanitizeRagContent(h.chunkText),
          })),
        };
      } catch (err) {
        console.error("[Cinder] search_help error:", err);
        return { results: [], error: "Recherche indisponible" };
      }
    },
  });
}
