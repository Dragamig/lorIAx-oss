/**
 * Instanciation d'un template de design — pendant, pour les designs du Studio,
 * de `instantiateTemplate` (documents). Charge la ligne `design_templates`,
 * clone son `content` (DesignDocument) et substitue le texte des calques texte
 * « variabilisés » (repérés par une propriété custom `layerId` stable dans le
 * JSON Fabric) par les valeurs fournies.
 *
 * Siloing : un template non-global ne peut être instancié que depuis son espace
 * (paramètre `spaceId`) — sinon il est traité comme introuvable (pas de leak).
 *
 * Code pur JS sur le JSON Fabric (`canvas.toJSON()`) : aucune dépendance à
 * `fabric` ni à du code client runtime.
 */
import { db } from "@/lib/db";
import { designTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { DesignDocument } from "@/components/editor/extensions/design-constants";

/** Levée quand le template de design est introuvable (ou hors périmètre d'espace). */
export class DesignTemplateNotFoundError extends Error {
  constructor(public readonly templateId: string) {
    super(`Template de design introuvable : ${templateId}`);
    this.name = "DesignTemplateNotFoundError";
  }
}

export interface InstantiatedDesign {
  name: string;
  design: DesignDocument;
}

/** Objet Fabric minimal manipulé ici (calque texte éventuellement groupé). */
interface FabricObject {
  type?: string;
  text?: string;
  layerId?: string;
  objects?: FabricObject[];
  [key: string]: unknown;
}

/**
 * Parcourt récursivement une liste d'objets Fabric (y compris ceux imbriqués
 * dans des groupes) et applique `visit` à chacun.
 */
function walkObjects(objects: FabricObject[] | undefined, visit: (obj: FabricObject) => void): void {
  if (!Array.isArray(objects)) return;
  for (const obj of objects) {
    if (!obj || typeof obj !== "object") continue;
    visit(obj);
    // Les groupes Fabric portent leurs enfants dans `objects`.
    if (Array.isArray(obj.objects)) {
      walkObjects(obj.objects, visit);
    }
  }
}

export async function instantiateDesignTemplate(
  templateId: string,
  values: Record<string, string>,
  opts: { spaceId?: string } = {}
): Promise<InstantiatedDesign> {
  const [tpl] = await db
    .select()
    .from(designTemplates)
    .where(eq(designTemplates.id, templateId))
    .limit(1);
  if (!tpl) throw new DesignTemplateNotFoundError(templateId);

  // Siloing : un template non-global exige un `spaceId` fourni ET correspondant.
  // On ne saute PAS le contrôle quand `opts.spaceId` est indéfini, sinon un
  // template d'espace d'une autre org serait instanciable si son UUID est connu
  // (undefined ≠ spaceId → introuvable).
  if (!tpl.isGlobal && tpl.spaceId !== opts.spaceId) {
    throw new DesignTemplateNotFoundError(templateId);
  }

  // Deep-clone : on ne mute jamais l'objet chargé depuis la BDD.
  const design: DesignDocument =
    typeof structuredClone === "function"
      ? structuredClone(tpl.content)
      : JSON.parse(JSON.stringify(tpl.content));

  const variables = Array.isArray(tpl.variables) ? tpl.variables : [];

  for (const v of variables) {
    const value = values[v.key];
    if (value === undefined) continue; // pas de valeur → placeholder inerte conservé

    for (const page of design.pages ?? []) {
      const json = page.json as { objects?: FabricObject[] } | null;
      if (!json) continue; // page vide
      walkObjects(json.objects, (obj) => {
        if (obj.layerId === v.layerId && typeof obj.text === "string") {
          obj.text = value;
        }
      });
    }
  }

  return { name: tpl.name, design };
}
