/**
 * Action « notify_user » — crée une notification interne (cloche + email
 * best-effort) pour un destinataire interpolé depuis le contexte d'exécution.
 */
import { z } from "zod";
import { createNotification } from "@/lib/notifications";
import { interpolate } from "@/lib/automations/interpolate";
import type { ActionDefinition, ExecutionContext } from "./types";

const configSchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1).max(500),
  message: z.string().max(2_000).optional(),
});

function resolve(actionConfig: Record<string, unknown>, ctx: ExecutionContext) {
  const parsed = configSchema.safeParse(actionConfig ?? {});
  if (!parsed.success) {
    throw new Error(`Config notify_user invalide : ${parsed.error.issues[0].message}`);
  }
  const cfg = parsed.data;
  const userId = interpolate(cfg.userId, ctx).trim();
  if (!userId) throw new Error("notify_user : destinataire vide après interpolation");
  const title = interpolate(cfg.title, ctx);
  const message = cfg.message ? interpolate(cfg.message, ctx) : undefined;
  return { userId, title, message };
}

export const notifyUserAction: ActionDefinition = {
  type: "notify_user",
  configSchema,
  async execute(actionConfig, _automation, ctx) {
    const { userId, title, message } = resolve(actionConfig, ctx);
    await createNotification({ userId, type: "automation", title, ...(message ? { message } : {}) });
    return { notified: { userId } };
  },
  async simulate(actionConfig, _automation, ctx) {
    const { userId } = resolve(actionConfig, ctx);
    return { notified: { userId }, simulated: true };
  },
};
