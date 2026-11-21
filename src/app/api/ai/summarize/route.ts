import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkDocumentViewAccess } from "@/lib/auth/check-access";
import { getLanguageModelForUsageInOrg, isAnyAIProviderConfigured } from "@/lib/ai/provider-resolver";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readDocument } from "@/lib/storage/filesystem";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  if (!(await isAnyAIProviderConfigured())) {
    return NextResponse.json(
      { error: "Aucun provider IA configuré. Configurez un provider dans /admin/ai/providers." },
      { status: 503 }
    );
  }

  const { documentId } = await request.json();

  if (!documentId) {
    return NextResponse.json({ error: "documentId requis" }, { status: 400 });
  }

  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) {
    return NextResponse.json({ error: "Document non trouve" }, { status: 404 });
  }

  // Vérifier les permissions de lecture (cloisonnement multi-tenant inclus)
  const canView = await checkDocumentViewAccess(user, doc.spaceId, doc.id);
  if (!canView) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Lire le contenu
  const [space] = await db
    .select()
    .from(spaces)
    .where(eq(spaces.id, doc.spaceId))
    .limit(1);

  let content = doc.contentText || "";
  if (space) {
    try {
      content = await readDocument(space.gitRepoPath, doc.filePath);
    } catch {
      // Utiliser contentText comme fallback
    }
  }

  if (!content) {
    return NextResponse.json({ error: "Document vide" }, { status: 400 });
  }

  // Cloisonnement AZ-06 (lot 6) : le fournisseur est choisi dans la portée de
  // la requête. Le document résumé appartient déjà à cette organisation, son
  // accès venant d'être vérifié par `checkDocumentViewAccess`.
  const { languageModel } = await getLanguageModelForUsageInOrg(
    "summary_doc",
    await getRequestOrgId(user)
  );

  const { text } = await generateText({
    model: languageModel,
    system:
      "Tu es un assistant qui produit des resumes concis et structures en francais. Utilise des bullet points.",
    prompt: `Resume le document suivant :\n\n# ${doc.title}\n\n${content}`,
  });

  return NextResponse.json({ summary: text });
}
