import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { userDatabaseColumns } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { getLanguageModel, getDefaultProvider } from "@/lib/ai/provider";
import { checkBaseAIQuota } from "@/lib/ai/base-ai-quota";
import { logAIUsage } from "@/lib/ai/usage-logger";
import { buildFormulaPromptReference } from "@/components/editor/extensions/database-block/formula-functions";

/**
 * Phase 8 — IA aide à la rédaction de formules.
 *
 * POST /api/databases/ai-formula
 * { databaseId, prompt } → { formula, explanation }
 *
 * Le frontend (database-column-header) appelle ce endpoint avec une
 * description en langage naturel, et reçoit une formule conforme à notre
 * évaluateur (formula-evaluator.ts) accompagnée d'une explication courte.
 *
 * Siloing : requireOrgScoped(database). L'IA reçoit la liste des colonnes
 * pour contexte (noms + types) mais JAMAIS les valeurs des cellules.
 *
 * Quotas Free : 50 requêtes/org/jour, appliqués via checkBaseAIQuota().
 */

const responseSchema = z.object({
  formula: z.string().min(1).max(500),
  explanation: z.string().min(1).max(300),
});

// Liste des fonctions et opérateurs supportés par notre évaluateur — utilisée
// dans le system prompt pour cadrer la génération. Source unique de vérité :
// formula-functions.ts (partagée avec la page d'aide /bases/aide-formules).
const SUPPORTED_FUNCTIONS = buildFormulaPromptReference();

function isAIConfigured(): boolean {
  const provider = getDefaultProvider();
  if (provider.name === "claude") return !!process.env.ANTHROPIC_API_KEY;
  if (provider.name === "openai") return !!process.env.OPENAI_API_KEY;
  if (provider.name === "ollama") return !!process.env.OLLAMA_BASE_URL;
  if (provider.name === "mistral") return !!process.env.MISTRAL_API_KEY;
  return false;
}

export async function POST(request: NextRequest) {
  if (!isAIConfigured()) {
    return NextResponse.json(
      { error: "Aucun provider IA configuré." },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const databaseId = String(body?.databaseId ?? "");
  const prompt = String(body?.prompt ?? "").trim();

  if (!databaseId) {
    return NextResponse.json({ error: "databaseId requis" }, { status: 400 });
  }
  if (prompt.length < 5) {
    return NextResponse.json(
      { error: "Décrivez la formule en au moins 5 caractères" },
      { status: 400 }
    );
  }
  if (prompt.length > 1000) {
    return NextResponse.json({ error: "Description trop longue (max 1000)" }, { status: 400 });
  }

  let ctx;
  try {
    ctx = await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const quota = await checkBaseAIQuota(ctx.user.id, "database_ai_formula");
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: `Quota IA Free atteint : ${quota.used}/${quota.limit} formules sur les dernières 24h.`,
        used: quota.used,
        limit: quota.limit,
      },
      { status: 429 },
    );
  }

  // Récupérer les colonnes (sans rows ni metadata sensible) pour contexte IA
  const columns = await db
    .select({
      name: userDatabaseColumns.name,
      type: userDatabaseColumns.type,
    })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, databaseId))
    .orderBy(asc(userDatabaseColumns.position));

  if (columns.length === 0) {
    return NextResponse.json(
      { error: "La base n'a pas encore de colonne — ajoutez-en avant de demander une formule" },
      { status: 400 }
    );
  }

  const columnsContext = columns
    .map((c) => `- "${c.name}" (${c.type})`)
    .join("\n");

  const provider = getDefaultProvider();
  try {
    const model = getLanguageModel();
    const result = await generateObject({
      model,
      schema: responseSchema,
      system: `Tu rédiges des formules pour un évaluateur custom (syntaxe inspirée de Notion/Airtable).

${SUPPORTED_FUNCTIONS}

Règles :
- Référencer une colonne avec prop("Nom exact"), respect de la casse.
- Renvoyer UNIQUEMENT la formule dans le champ "formula", sans la préfixer
  par un "=" et sans guillemets autour.
- L'explication doit faire 1 ou 2 phrases courtes en français.
- Si la demande ne peut pas se traduire avec les fonctions disponibles,
  renvoyer une formule simple type concat("non supporté: ", ...) plutôt
  que d'inventer des fonctions.

Colonnes disponibles dans cette base :
${columnsContext}`,
      prompt,
    });

    logAIUsage({
      userId: ctx.user.id,
      providerId: provider.name,
      model: provider.model,
      usageType: "database_ai_formula",
      status: "success",
    });
    return NextResponse.json(result.object);
  } catch (err) {
    logAIUsage({
      userId: ctx.user.id,
      providerId: provider.name,
      model: provider.model,
      usageType: "database_ai_formula",
      status: "error",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Erreur génération formule : ${err.message}`
            : "Erreur génération formule",
      },
      { status: 502 }
    );
  }
}
