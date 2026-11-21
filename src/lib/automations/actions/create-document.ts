/**
 * Action « create_document » (W1, MVP), crée un document dans un espace, à
 * partir d'un template optionnel dont le markdown est interpolé. Pensée d'abord
 * pour les workflows autonomes (bouton dans un document), mais utilisable aussi
 * en contexte base-lié.
 *
 * Résolution de l'espace cible (priorité) : `cfg.spaceId` (interpolé) →
 * `ctx.spaceId` → `automation.spaceId`, la cascade étant portée par
 * `lib/automations/target-space.ts`, qui la VALIDE contre l'organisation de
 * l'automatisation (constat INJ-12). Auteur : utilisateur déclencheur
 * (`ctx.user`) sinon créateur de l'automation.
 */
import { z } from "zod";
import { interpolate } from "@/lib/automations/interpolate";
import { buildBindingPayload } from "@/lib/automations/template-variables";
import { instantiateTemplate } from "@/lib/templates/instantiate";
import { createDocument } from "@/lib/documents/create-document";
import { resolveTargetSpaceId } from "@/lib/automations/target-space";
import {
  createSpreadsheetDocument,
  ParentDocumentNotFoundError,
} from "@/lib/documents/create-spreadsheet-document";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { ActionDefinition, AutomationRow, ExecutionContext } from "./types";
import { simId } from "./simulation";

const configSchema = z.object({
  // Mode : document classique (défaut) ou tableur de demande (classeur Lignes +
  // Exigences vide, créé depuis le gabarit). Le mode tableur ignore templateId.
  kind: z.enum(["document", "demand_workbook"]).optional(),
  // Override de l'espace cible (interpolable). Défaut : espace du contexte.
  spaceId: z.string().optional(),
  // Template source (builtin_ ou id BDD). Si absent : document vide.
  templateId: z.string().optional(),
  // Data-binding des placeholders du template : clé → source. Résolu à
  // l'exécution en `extra` pour instantiateTemplate (Task 12).
  bindings: z
    .record(
      z.string(),
      z.object({
        kind: z.enum(["cells", "variables", "user", "static"]),
        ref: z.string(),
      })
    )
    .optional(),
  title: z.string().min(1),
  parentId: z.string().optional(),
  classification: z.enum(["public", "internal", "confidential", "secret"]).optional(),
});

async function prepare(
  actionConfig: Record<string, unknown>,
  automation: AutomationRow,
  ctx: ExecutionContext
) {
  const parsed = configSchema.safeParse(actionConfig ?? {});
  if (!parsed.success) {
    throw new Error(`Config create_document invalide : ${parsed.error.issues[0].message}`);
  }
  const cfg = parsed.data;

  // Cascade de résolution ET contrôle de cloisonnement : un `spaceId` de
  // config ne peut pas désigner l'espace d'une autre organisation.
  const spaceId = await resolveTargetSpaceId({
    actionType: "create_document",
    configSpaceId: cfg.spaceId,
    automation,
    ctx,
  });
  if (!spaceId) {
    throw new Error("create_document : aucun espace cible (ni config, ni contexte, ni automation)");
  }

  const createdBy = ctx.user?.id ?? automation.createdBy ?? undefined;
  if (!createdBy) {
    throw new Error("create_document : auteur introuvable (ni utilisateur déclencheur, ni créateur)");
  }

  const title = interpolate(cfg.title, ctx);
  const extra = cfg.bindings ? buildBindingPayload(cfg.bindings, ctx) : undefined;
  return { cfg, spaceId, createdBy, title, extra };
}

/**
 * Sortie du mode tableur de demande. `link` est la valeur prête à écrire dans
 * une colonne `document_link` ({id,title,spaceSlug} en JSON) : à utiliser telle
 * quelle via `{{variables.<étape>.createdDocument.link}}`, car recomposer ce
 * JSON dans un gabarit casse dès que le titre contient un guillemet.
 */
function demandDocumentOutput(id: string, title: string, spaceSlug: string) {
  return { id, title, spaceSlug, link: JSON.stringify({ id, title, spaceSlug }) };
}

export const createDocumentAction: ActionDefinition = {
  type: "create_document",
  configSchema,
  async execute(actionConfig, automation, ctx) {
    const { cfg, spaceId, createdBy, title, extra } = await prepare(actionConfig, automation, ctx);
    if (cfg.kind === "demand_workbook") {
      const authorName = ctx.user?.name ?? "LorIAx Workflow";
      const authorEmail = ctx.user?.email ?? "workflow@loriax.local";
      let result;
      try {
        result = await createSpreadsheetDocument({
          spaceId,
          title,
          parentId: cfg.parentId ? interpolate(cfg.parentId, ctx) : null,
          classification: cfg.classification,
          createdBy,
          authorName,
          authorEmail,
          activitySource: "automation",
        });
      } catch (err) {
        if (err instanceof ParentDocumentNotFoundError) {
          throw new Error("create_document : document parent introuvable dans l'espace cible");
        }
        throw err;
      }
      const { document } = result;
      const [space] = await db
        .select({ slug: spaces.slug })
        .from(spaces)
        .where(eq(spaces.id, spaceId))
        .limit(1);
      return {
        createdDocument: demandDocumentOutput(document.id, document.title, space?.slug ?? ""),
      };
    }
    let content: string | undefined;
    if (cfg.templateId) {
      const tpl = await instantiateTemplate(cfg.templateId, ctx, { spaceId, extra });
      content = tpl.markdown;
    }

    const created = await createDocument({
      spaceId,
      title,
      content,
      parentId: cfg.parentId ? interpolate(cfg.parentId, ctx) : null,
      classification: cfg.classification,
      createdBy,
      authorName: ctx.user?.name ?? "LorIAx Workflow",
      authorEmail: ctx.user?.email ?? "workflow@loriax.local",
      activitySource: "automation",
    });

    return { createdDocument: { id: created.id, title: created.title } };
  },
  async simulate(actionConfig, automation, ctx) {
    const { cfg, title } = await prepare(actionConfig, automation, ctx);
    if (cfg.kind === "demand_workbook") {
      return { createdDocument: demandDocumentOutput(simId(), title, "sim-space"), simulated: true };
    }
    return { createdDocument: { id: simId(), title }, simulated: true };
  },
};
