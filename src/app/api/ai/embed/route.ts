import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { indexDocument, isEmbeddingConfigured } from "@/lib/ai/embeddings";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import logger from "@/lib/logger";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // Rate limiting par utilisateur
  const rl = checkRateLimit(`embed:${user.id}`, RATE_LIMITS.embed);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Trop de requêtes d'indexation. Réessayez dans quelques instants." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  if (!isEmbeddingConfigured()) {
    return NextResponse.json(
      { error: "Aucun provider d'embeddings configuré. Ajoutez OPENAI_API_KEY ou configurez Ollama." },
      { status: 503 }
    );
  }

  const { documentId } = await request.json();

  if (!documentId) {
    return NextResponse.json({ error: "documentId requis" }, { status: 400 });
  }

  // Meme trou que sur /api/ai/summarize : la route acceptait n'importe quel identifiant.
  // Indexer un document, c'est en decouper le contenu dans la table d'embeddings, donc
  // le rendre atteignable par la recherche semantique. Le droit de lecture est exige.
  const [doc] = await db
    .select({ id: documents.id, spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document non trouve" }, { status: 404 });
  }

  const canView = await checkDocumentViewAccess(user, doc.spaceId, doc.id);
  if (!canView) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  try {
    await indexDocument(documentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error, documentId }, "Erreur indexation embedding");
    return NextResponse.json(
      { error: "Erreur lors de l'indexation" },
      { status: 500 }
    );
  }
}
