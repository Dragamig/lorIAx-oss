/**
 * Instanciation d'un template en markdown interpolé — partagé par l'action de
 * workflow `create_document`. Charge le template (builtin par préfixe
 * `builtin_`, sinon table `templates`), en extrait le markdown et y substitue
 * les placeholders du contexte d'exécution ({{user.*}}, {{space.id}}, ...).
 *
 * Siloing : un template non-global ne peut être instancié que depuis son espace
 * (paramètre `spaceId`) — sinon il est traité comme introuvable (pas de leak).
 */
import { db } from "@/lib/db";
import { templates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getBuiltinTemplateById } from "@/lib/templates/builtin";
import { interpolate, type InterpolationPayload } from "@/lib/automations/interpolate";

/** Levée quand le template est introuvable (ou hors périmètre d'espace). */
export class TemplateNotFoundError extends Error {
  constructor(public readonly templateId: string) {
    super(`Template introuvable : ${templateId}`);
    this.name = "TemplateNotFoundError";
  }
}

export interface InstantiatedTemplate {
  name: string;
  markdown: string;
}

export async function instantiateTemplate(
  templateId: string,
  ctx: InterpolationPayload,
  opts: { spaceId?: string; extra?: Record<string, string> } = {}
): Promise<InstantiatedTemplate> {
  if (templateId.startsWith("builtin_")) {
    const builtin = getBuiltinTemplateById(templateId);
    if (!builtin) throw new TemplateNotFoundError(templateId);
    return {
      name: builtin.name,
      markdown: interpolate(builtin.content.markdown ?? "", ctx, opts.extra),
    };
  }

  const [tpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, templateId))
    .limit(1);
  if (!tpl) throw new TemplateNotFoundError(templateId);

  // Siloing : un template d'espace ne s'instancie que depuis cet espace.
  if (!tpl.isGlobal && opts.spaceId && tpl.spaceId !== opts.spaceId) {
    throw new TemplateNotFoundError(templateId);
  }

  const content = (tpl.content ?? {}) as { markdown?: string };
  return {
    name: tpl.name,
    markdown: interpolate(content.markdown ?? "", ctx, opts.extra),
  };
}
