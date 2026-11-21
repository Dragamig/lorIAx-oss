import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { checkDocumentEditAccess } from "@/lib/auth/check-access";
import { indexDocument, isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { checkRateLimitAsync, RATE_LIMITS } from "@/lib/rate-limit";
import logger from "@/lib/logger";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  // Rate limiting par utilisateur
  const rl = await checkRateLimitAsync(`embed:${user.id}`, RATE_LIMITS.embed);
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

  if (!(await isEmbeddingConfiguredAsync())) {
    return NextResponse.json(
      { error: "Aucun provider d'embeddings configuré. Ajoutez OPENAI_API_KEY ou configurez Ollama." },
      { status: 503 }
    );
  }

  const { documentId } = await request.json();

  if (!documentId || typeof documentId !== "string") {
    return NextResponse.json({ error: "documentId requis" }, { status: 400 });
  }

  // Contrôle d'accès avant toute indexation : sans lui, n'importe quel
  // utilisateur authentifié pouvait forcer la réindexation (et tester
  // l'existence) de n'importe quel document, y compris d'une autre organisation.
  const [doc] = await db
    .select({ id: documents.id, spaceId: documents.spaceId })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document introuvable" }, { status: 404 });
  }

  const canEdit = await checkDocumentEditAccess(user, doc.spaceId, doc.id);
  if (!canEdit) {
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
