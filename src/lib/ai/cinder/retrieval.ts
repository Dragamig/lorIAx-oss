import { ilike, or, and, inArray, notInArray, sql, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { searchSemantic, isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { rerankCandidates, fetchLimitForRerank } from "@/lib/ai/rerank";
import { sanitizeRagContent } from "@/lib/ai/sanitize-content";
import { searchKb } from "@/lib/kb/kb";
import { buildMediaChatContext } from "@/lib/media/ai/content-search";
import { isModuleActive } from "@/lib/modules/enablement";
import type { SessionUser } from "@/types";

/**
 * RAG documents : recherche sémantique si disponible, sinon repli ILIKE reclassé.
 * Aucun espace accessible ou requête trop courte : aucun contexte (fail-closed).
 */
export async function buildDocumentContext(input: {
  query: string;
  user: SessionUser;
  orgId: string | null;
  spaceIds: string[];
  admin: boolean;
}): Promise<string> {
  const { query: lastMessage, user, orgId, spaceIds, admin } = input;
  let contextDocs = "";

  if (lastMessage.length > 3 && spaceIds.length > 0) {
    if (await isEmbeddingConfiguredAsync()) {
      try {
        // Recherche sémantique scopée sur les espaces accessibles.
        const semanticResults = await searchSemantic(lastMessage, 5, {
          spaceIds,
          viewerId: user.id,
          isGlobalAdmin: admin,
          organizationId: orgId,
        });

        if (semanticResults.length > 0) {
          // Retirer les documents « secret » pour les non-admins.
          let allowed = semanticResults;
          if (!admin) {
            const docIds = [
              ...new Set(semanticResults.map((r) => r.documentId)),
            ];
            const docs = await db
              .select({
                id: documents.id,
                classification: documents.classification,
              })
              .from(documents)
              .where(inArray(documents.id, docIds));
            const blocked = new Set(
              docs
                .filter((d) => d.classification === "secret")
                .map((d) => d.id)
            );
            allowed = semanticResults.filter((r) => !blocked.has(r.documentId));
          }

          if (allowed.length > 0) {
            contextDocs = allowed
              .map((r) => sanitizeRagContent(r.chunkText))
              .join("\n\n---\n\n");
          }
        }
      } catch {
        // Fallback vers ILIKE
      }
    }

    // Fallback ILIKE si pas de résultats sémantiques
    if (!contextDocs) {
      const pattern = `%${lastMessage.slice(0, 100)}%`;

      // SEC-01 : filtrage par espace (org courante) + classification
      const conditions = [
        or(
          ilike(documents.title, pattern),
          ilike(documents.contentText, pattern)
        ),
        inArray(documents.spaceId, spaceIds),
      ];

      if (!admin) {
        conditions.push(notInArray(documents.classification, ["secret"]));
      }

      // Troncature côté SQL : seuls les 1500 premiers caractères servent
      // (reclassement puis extrait de contexte), inutile de rapatrier le
      // texte entier de chaque document candidat.
      const relevantDocs = await db
        .select({
          title: documents.title,
          contentText: sql<string>`substring(${documents.contentText}, 1, 1500)`,
        })
        .from(documents)
        .where(and(...conditions))
        // Ordre stable : sans ORDER BY, l'ensemble des candidats soumis au
        // reclassement pourrait varier d'un appel à l'autre pour une même
        // recherche, et avec lui le résultat final et la clé de cache du
        // reclassement (cf. le même correctif dans searchKbFallback).
        .orderBy(asc(documents.id))
        .limit(fetchLimitForRerank(5));

      // Le repli ILIKE ne classe rien par pertinence : reclassement avant usage.
      const reclasses = await rerankCandidates(lastMessage, relevantDocs, {
        getText: (doc) => `${doc.title}\n\n${(doc.contentText || "").slice(0, 1500)}`,
        topN: 5,
        surface: "chat",
        userId: user.id,
        organizationId: orgId,
      });

      if (reclasses.length > 0) {
        contextDocs = reclasses
          .map(
            (d) =>
              `## ${sanitizeRagContent(d.title)}\n${sanitizeRagContent(
                (d.contentText || "").slice(0, 500)
              )}`
          )
          .join("\n\n---\n\n");
      }
    }
  }

  return contextDocs;
}

/**
 * Médias de la médiathèque : identité de la session et organisation de la requête
 * fermées ici (jamais fournies par le modèle), seulement si le module est actif.
 */
export async function buildMediaContext(input: {
  query: string;
  user: SessionUser;
  orgId: string | null;
}): Promise<string> {
  const { query, user, orgId } = input;
  if (query.length <= 3 || !orgId) return "";
  try {
    if (await isModuleActive("library", orgId)) {
      return await buildMediaChatContext(user, orgId, query);
    }
  } catch (err) {
    console.error("[Cinder] media context error:", err);
  }
  return "";
}

/** Documentation produit (KB d'aide, commune à l'instance), extraits assainis. */
export async function buildProductDocs(
  query: string,
  userId: string,
  limit = 3,
): Promise<string> {
  if (query.length <= 3) return "";
  try {
    const hits = await searchKb(query, limit, userId);
    return hits.map((h) => sanitizeRagContent(h.chunkText)).join("\n\n---\n\n");
  } catch (err) {
    console.error("[Cinder] searchKb error:", err);
    return "";
  }
}
