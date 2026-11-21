import { userDatabaseViews } from "@/lib/db/schema";
import { viewConfigSchema } from "@/lib/bases/view-config";
import type { DbExecutor } from "../row-writes";
import { normalizeTemplateName } from "./columns";
import { TemplateFailure, type TemplateView } from "./types";

/**
 * Insère les vues partagées d'une base qui vient d'être créée (jamais d'une base existante).
 * Noms uniques par base (index partiel `scope = 'shared'`) ; config validée par viewConfigSchema.
 */
export async function insertViews(
  tx: DbExecutor,
  databaseId: string,
  userId: string,
  key: string,
  views: TemplateView[],
  columns: Record<string, string>,
): Promise<void> {
  const seen = new Set<string>();
  for (const [position, view] of views.entries()) {
    const norm = normalizeTemplateName(view.name);
    if (seen.has(norm)) throw new TemplateFailure({ code: "name_collision", key });
    seen.add(norm);
    const config = viewConfigSchema.parse(view.config(columns));
    await tx.insert(userDatabaseViews).values({
      databaseId,
      name: view.name,
      type: view.type,
      config,
      isDefault: position === 0,
      position,
      scope: "shared",
      createdBy: userId,
    });
  }
}
