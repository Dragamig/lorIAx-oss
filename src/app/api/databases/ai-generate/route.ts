import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { userDatabases, userDatabaseColumns } from "@/lib/db/schema";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { getLanguageModel, getDefaultProvider } from "@/lib/ai/provider";
import { checkBaseAIQuota } from "@/lib/ai/base-ai-quota";
import { logAIUsage } from "@/lib/ai/usage-logger";

/**
 * Phase 7 — IA création de base (option luxe).
 *
 * Deux modes :
 *   - POST { mode: "propose", description } → renvoie un plan de schéma
 *     (nom + colonnes) en JSON validé Zod. Ne crée RIEN en BDD.
 *   - POST { mode: "apply", spaceId, plan } → applique le plan en
 *     transaction. requireOrgScoped(space) avec minPermission=editor.
 *
 * Le frontend orchestre les 2 modes (mode plan → confirm utilisateur → apply).
 *
 * Siloing : requireOrgScoped sur le space en mode apply ; le mode propose
 * n'écrit rien donc n'a besoin que d'auth (vérifié par la session).
 *
 * Quotas Free : 10 propositions/org/jour, appliqués via checkBaseAIQuota().
 */

const COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
  "url",
  "email",
  "formula",
] as const;

const planSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(500).optional(),
  columns: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        type: z.enum(COLUMN_TYPES),
        options: z.array(z.string()).optional().describe("Options pour les colonnes select"),
      })
    )
    .min(1)
    .max(20),
});

type Plan = z.infer<typeof planSchema>;

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
      {
        error:
          "Aucun provider IA configuré pour cette organisation. Activez l'IA dans les paramètres.",
      },
      { status: 503 }
    );
  }

  let baseCtx;
  try {
    // Le mode propose requiert juste auth/org, mode apply requiert space+editor.
    // On valide l'org dans tous les cas pour ne pas leak l'absence de config.
    baseCtx = await requireOrgScoped();
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode;
  const provider = getDefaultProvider();

  // ─── Mode "propose" : génère un plan, n'écrit rien ─────────────────────
  if (mode === "propose") {
    const quota = await checkBaseAIQuota(baseCtx.user.id, "database_ai_create");
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `Quota IA Free atteint : ${quota.used}/${quota.limit} créations de base sur les dernières 24h.`,
          used: quota.used,
          limit: quota.limit,
        },
        { status: 429 },
      );
    }
    const description = String(body.description ?? "").trim();
    if (!description || description.length < 10) {
      return NextResponse.json(
        { error: "Décrivez la base souhaitée en au moins 10 caractères" },
        { status: 400 }
      );
    }
    if (description.length > 2000) {
      return NextResponse.json({ error: "Description trop longue (max 2000)" }, { status: 400 });
    }

    try {
      const model = getLanguageModel();
      const result = await generateObject({
        model,
        schema: planSchema,
        system: `Tu es un assistant qui conçoit des schémas de bases de type Airtable.
Tu reçois une description en langage naturel et tu proposes un schéma de base structuré
avec un nom court, une description optionnelle, et 3 à 15 colonnes pertinentes.

Types autorisés : ${COLUMN_TYPES.join(", ")}.
Règles :
- Toujours commencer par une colonne "text" pour le nom/titre principal.
- Pour les colonnes "select", fournir entre 2 et 8 options pertinentes au domaine.
- "formula" uniquement quand la valeur peut se calculer à partir d'autres colonnes.
- Ne PAS proposer de colonne "id" ou "createdAt" — elles existent automatiquement.
- Préférer des noms de colonne courts (1 à 3 mots), en français.
- Maximum 15 colonnes.`,
        prompt: description,
      });
      logAIUsage({
        userId: baseCtx.user.id,
        providerId: provider.name,
        model: provider.model,
        usageType: "database_ai_create",
        status: "success",
      });
      return NextResponse.json({ plan: result.object });
    } catch (err) {
      logAIUsage({
        userId: baseCtx.user.id,
        providerId: provider.name,
        model: provider.model,
        usageType: "database_ai_create",
        status: "error",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? `Erreur génération IA : ${err.message}`
              : "Erreur génération IA",
        },
        { status: 502 }
      );
    }
  }

  // ─── Mode "apply" : crée la base depuis un plan validé ─────────────────
  if (mode === "apply") {
    const spaceId = String(body.spaceId ?? "");
    const planInput = body.plan;
    if (!spaceId) {
      return NextResponse.json({ error: "spaceId requis" }, { status: 400 });
    }
    const parsedPlan = planSchema.safeParse(planInput);
    if (!parsedPlan.success) {
      return NextResponse.json(
        { error: `Plan invalide : ${parsedPlan.error.issues[0].message}` },
        { status: 400 }
      );
    }

    // Vérifier l'autorisation sur le space (siloing strict)
    let scopedCtx;
    try {
      scopedCtx = await requireOrgScoped({
        resource: { type: "space", id: spaceId },
        minPermission: "editor",
      });
    } catch (e) {
      if (e instanceof OrgScopeError) return e.response;
      throw e;
    }

    const created = await applyPlan(parsedPlan.data, spaceId, scopedCtx.user.id);
    return NextResponse.json(created, { status: 201 });
  }

  return NextResponse.json(
    { error: 'mode invalide (attendu "propose" ou "apply")' },
    { status: 400 }
  );
}

async function applyPlan(plan: Plan, spaceId: string, userId: string) {
  // Transaction explicite : si l'insertion des colonnes échoue, la database
  // n'est pas créée (sinon on aurait une base orpheline sans colonnes).
  return db.transaction(async (tx) => {
    const [database] = await tx
      .insert(userDatabases)
      .values({
        spaceId,
        name: plan.name,
        description: plan.description ?? null,
        createdBy: userId,
      })
      .returning();

    if (plan.columns.length > 0) {
      await tx.insert(userDatabaseColumns).values(
        plan.columns.map((col, i) => ({
          databaseId: database.id,
          name: col.name,
          type: col.type,
          config: col.options ? { options: col.options } : {},
          position: i,
        }))
      );
    }

    return database;
  });
}
