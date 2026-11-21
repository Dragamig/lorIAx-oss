/**
 * Action « create_task » (W1, MVP) — crée une tâche, éventuellement assignée et
 * datée. `assigneeId` est interpolable (ex. `{{user.id}}` pour s'auto-assigner
 * depuis un bouton). `documentId` par défaut = document déclencheur (`ctx`).
 */
import { z } from "zod";
import { interpolate } from "@/lib/automations/interpolate";
import { createTask } from "@/lib/tasks/create-task";
import type { ActionDefinition, AutomationRow, ExecutionContext } from "./types";
import { simId } from "./simulation";

const configSchema = z.object({
  title: z.string().min(1),
  assigneeId: z.string().optional(),
  // Date d'échéance ISO (interpolable) ; ignorée si non parsable.
  dueAt: z.string().optional(),
  documentId: z.string().optional(),
});

function resolve(
  actionConfig: Record<string, unknown>,
  automation: AutomationRow,
  ctx: ExecutionContext
) {
  const parsed = configSchema.safeParse(actionConfig ?? {});
  if (!parsed.success) {
    throw new Error(`Config create_task invalide : ${parsed.error.issues[0].message}`);
  }
  const cfg = parsed.data;

  const createdBy = ctx.user?.id ?? automation.createdBy ?? undefined;
  if (!createdBy) {
    throw new Error("create_task : auteur introuvable (ni utilisateur déclencheur, ni créateur)");
  }

  const title = interpolate(cfg.title, ctx);
  const assigneeRaw = cfg.assigneeId ? interpolate(cfg.assigneeId, ctx) : "";
  const assigneeId = assigneeRaw.length > 0 ? assigneeRaw : null;

  let dueAt: Date | null = null;
  if (cfg.dueAt) {
    const d = new Date(interpolate(cfg.dueAt, ctx));
    if (!Number.isNaN(d.getTime())) dueAt = d;
  }

  const documentId =
    (cfg.documentId ? interpolate(cfg.documentId, ctx) : "") || ctx.documentId || null;

  return { title, createdBy, assigneeId, dueAt, documentId };
}

export const createTaskAction: ActionDefinition = {
  type: "create_task",
  configSchema,
  async execute(actionConfig, automation, ctx) {
    const created = await createTask(resolve(actionConfig, automation, ctx));
    return { createdTask: { id: created.id } };
  },
  async simulate(actionConfig, automation, ctx) {
    resolve(actionConfig, automation, ctx);
    return { createdTask: { id: simId() }, simulated: true };
  },
};
