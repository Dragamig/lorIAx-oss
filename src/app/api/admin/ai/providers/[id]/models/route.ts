import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { aiProviders } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { detectModels, detectRerankModels } from "@/lib/ai/detect-models";
import { resolveProviderScope } from "../../scope";
import type { ConnectorType } from "@/lib/ai/provider-presets";
import logger from "@/lib/logger";

// Détection des modèles d'un fournisseur déjà enregistré, en utilisant la clé
// stockée (chiffrée) côté serveur. Sert au sélecteur de modèle de la section
// « Assignation modèle par usage ». Le paramètre `usage=rerank` bascule sur
// la détection dédiée au reclassement, qui retombe toujours sur une liste
// statique plutôt que de rendre un sélecteur vide.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const { id } = await params;

  // Cloisonnement (audit AZ-06) : cette route déchiffre la clé stockée et
  // émet une requête sortante avec elle. Sans confrontation à l'organisation
  // de la requête, elle servait d'oracle sur les fournisseurs des autres
  // tenants. Lecture seule, donc un fournisseur de portée instance reste
  // consultable par un admin d'organisation.
  const scope = await resolveProviderScope(user, id, false);
  if (!scope.ok) return scope.response;

  const [provider] = await db
    .select()
    .from(aiProviders)
    .where(eq(aiProviders.id, id))
    .limit(1);

  if (!provider) {
    return NextResponse.json(
      { error: "Fournisseur introuvable" },
      { status: 404 }
    );
  }

  let apiKey: string | null = null;
  if (provider.apiKeyEnc) {
    try {
      apiKey = decrypt(provider.apiKeyEnc);
    } catch (err) {
      logger.warn({ err, providerId: id }, "Failed to decrypt provider API key");
    }
  }

  const usage = new URL(request.url).searchParams.get("usage");

  if (usage === "rerank") {
    const models = await detectRerankModels({
      connectorType: provider.connectorType as ConnectorType,
      apiBaseUrl: provider.apiBaseUrl,
      apiKey,
    });
    return NextResponse.json({ models });
  }

  const result = await detectModels({
    connectorType: provider.connectorType as ConnectorType,
    apiBaseUrl: provider.apiBaseUrl,
    apiKey,
  });

  if (result.models.length === 0) {
    return NextResponse.json(
      { error: result.error || "Impossible de récupérer la liste des modèles" },
      { status: 502 }
    );
  }

  return NextResponse.json({ models: result.models, details: result.details });
}
