/**
 * Action « create_design » (Spec 2), instancie un template de design du Studio,
 * le rend en image côté serveur (PNG/PDF, sans navigateur), le stocke sur S3 et
 * expose une URL durable réutilisable par les étapes suivantes du workflow
 * (send_email en pièce jointe, notify_user, etc.).
 *
 * Pendant, pour les designs, de `create_document` : mêmes conventions de
 * résolution d'espace (`cfg.spaceId` interpolé → `ctx.spaceId` → `automation.spaceId`,
 * validée par `lib/automations/target-space.ts`, cf. constat INJ-12)
 * et de data-binding (`bindings` : placeholder → source, résolu via
 * `buildBindingPayload`).
 *
 * Stockage : l'image rendue entre dans la médiathèque par `ingestMedia`
 * (origine `automation`, espace de l'automatisation ou, à défaut, sans espace)
 * et l'URL de sortie est `/api/media/<uuid>`, stable et same-origin. Les
 * fichiers déjà écrits sous `designs/generated/` ne sont pas migrés. Quota
 * atteint : l'étape échoue avec un message « Quota atteint » dans le journal.
 * On ne persiste JAMAIS d'URL présignée expirante (cf. incident IMG-INSERTION).
 */
import { z } from "zod";
import { buildBindingPayload } from "@/lib/automations/template-variables";
import { instantiateDesignTemplate } from "@/lib/studio/instantiate-design-template";
import { renderDesign } from "@/lib/studio/render-design";
import { ingestMedia } from "@/lib/media/ingest";
import { resolveAutomationAnchor, resolveTargetSpaceId } from "@/lib/automations/target-space";
import type { SessionUser } from "@/types";
import type { ActionDefinition } from "./types";
import { simId } from "./simulation";

const configSchema = z.object({
  // Template de design source (id d'une ligne `design_templates`). Requis.
  templateId: z.string().min(1),
  // Override de l'espace cible (interpolable). Défaut : espace du contexte.
  spaceId: z.string().optional(),
  // Data-binding des placeholders du template : clé → source. Résolu à
  // l'exécution en valeurs pour `instantiateDesignTemplate` (même forme que
  // create_document).
  bindings: z
    .record(
      z.string(),
      z.object({
        kind: z.enum(["cells", "variables", "user", "static"]),
        ref: z.string(),
      })
    )
    .optional(),
  // Format de rendu de la sortie.
  format: z.enum(["png", "pdf"]).default("png"),
  // Nom logique (optionnel), utile en aval (nom de pièce jointe d'email p.ex.).
  filename: z.string().optional(),
  // Nom de variable où déposer la sortie pour les étapes suivantes, en
  // complément du `GraphNode.storeAs` géré par l'executor (cf. execute).
  storeAs: z.string().optional(),
});

export const createDesignAction: ActionDefinition = {
  type: "create_design",
  configSchema,
  async simulate(actionConfig, automation, ctx) {
    const parsed = configSchema.safeParse(actionConfig ?? {});
    if (!parsed.success) {
      throw new Error(`Config create_design invalide : ${parsed.error.issues[0].message}`);
    }
    const cfg = parsed.data;
    await resolveTargetSpaceId({
      actionType: "create_design",
      configSpaceId: cfg.spaceId,
      automation,
      ctx,
    });
    if (cfg.bindings) buildBindingPayload(cfg.bindings, ctx);
    const ext = cfg.format;
    const mediaId = simId();
    const createdDesign = {
      url: `/api/media/${mediaId}`,
      mediaId,
      key: `media/${mediaId}.${ext}`,
      contentType: ext === "pdf" ? "application/pdf" : "image/png",
      ext,
      ...(cfg.filename ? { filename: cfg.filename } : {}),
    };
    if (cfg.storeAs) {
      ctx.variables ??= {};
      ctx.variables[cfg.storeAs] = createdDesign;
    }
    return { createdDesign, simulated: true };
  },
  async execute(actionConfig, automation, ctx) {
    const parsed = configSchema.safeParse(actionConfig ?? {});
    if (!parsed.success) {
      throw new Error(`Config create_design invalide : ${parsed.error.issues[0].message}`);
    }
    const cfg = parsed.data;

    // Espace cible : ne PAS throw si absent, un template global n'en a pas
    // besoin et `instantiateDesignTemplate` tranche le siloing lui-même. En
    // revanche, un espace FOURNI est validé contre l'organisation de
    // l'automatisation : absent reste absent, invalide est refusé.
    const spaceId = await resolveTargetSpaceId({
      actionType: "create_design",
      configSpaceId: cfg.spaceId,
      automation,
      ctx,
    });

    // Placeholders → valeurs interpolées (cells/variables/user/static).
    const values = cfg.bindings ? buildBindingPayload(cfg.bindings, ctx) : {};

    const { design, name } = await instantiateDesignTemplate(cfg.templateId, values, { spaceId });
    const { buffer, contentType, ext } = await renderDesign(design, { format: cfg.format });

    // Organisation : ancre de l'automatisation (l'espace cible, validé plus
    // haut, en fait partie). Sans ancre, refus explicite dans le journal.
    const anchor = await resolveAutomationAnchor(automation);
    if (!anchor) {
      throw new Error("create_design : organisation de l'automatisation indéterminable");
    }
    const actorId = automation.createdBy ?? ctx.user?.id ?? null;
    if (!actorId) {
      throw new Error("create_design : aucun utilisateur identifiable pour verser l'image");
    }
    const actor: SessionUser = {
      id: actorId,
      email: ctx.user?.email ?? "",
      name: ctx.user?.name ?? "",
      globalRole: "editor",
      capabilities: [],
    };

    const baseName = (cfg.filename || name || "design").replace(/\.(png|pdf)$/i, "");
    const filename = `${baseName}.${ext}`;
    const ingested = await ingestMedia({
      user: actor,
      orgId: anchor.organizationId,
      spaceId: spaceId ?? anchor.spaceId ?? null,
      origin: "automation",
      allowOrgLevel: true,
      file: { name: filename, size: buffer.length, type: contentType },
      buffer,
    });
    if (!ingested.ok) {
      throw new Error(
        ingested.status === 507
          ? `create_design : Quota atteint (${ingested.error})`
          : `create_design : versement dans la médiathèque refusé (${ingested.error})`
      );
    }
    const mediaRow = ingested.media;

    const createdDesign = {
      url: `/api/media/${mediaRow.id}`,
      mediaId: mediaRow.id,
      key: mediaRow.storageKey,
      contentType,
      ext,
      ...(cfg.filename ? { filename: cfg.filename } : {}),
    };

    // Convention de variable : l'executor mappe le résultat retourné vers
    // `variables[GraphNode.storeAs]`. Le `storeAs` de config est en revanche
    // porté par l'action : on dépose alors explicitement la valeur (l'inner
    // objet) dans `ctx.variables` pour la rendre accessible via
    // `{{variables.<storeAs>.url}}` dès l'étape suivante.
    if (cfg.storeAs) {
      ctx.variables ??= {};
      ctx.variables[cfg.storeAs] = createdDesign;
    }

    return { createdDesign };
  },
};
