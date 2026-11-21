/**
 * Action « send_email » — envoie un email dont l'objet/corps/destinataire sont
 * interpolés depuis le contexte. Le HTML est sanitizé et le destinataire est
 * re-validé après interpolation (empêche un placeholder de détourner l'envoi).
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { sendEmail } from "@/lib/email/send";
import { interpolate } from "@/lib/automations/interpolate";
import type { ActionDefinition, ExecutionContext } from "./types";

const configSchema = z
  .object({
    // Destinataire littéral/interpolé (email). Alternative à `toUserId`.
    // Optionnel (l'alternative toUserId peut être utilisée seule), mais s'il
    // est fourni et non vide, doit être une adresse email valide — sauf s'il
    // contient un placeholder d'interpolation ({{...}}), résolu à l'exécution
    // et re-validé après interpolation (cf. execute ci-dessous).
    to: z
      .string()
      .optional()
      .refine((v) => !v || v.includes("{{") || z.string().email().safeParse(v).success, {
        message: "Adresse email invalide (to)",
      }),
    // Destinataire par id utilisateur (interpolable, ex. `{{user.id}}`) : son
    // email est chargé en base et prime sur `to`.
    toUserId: z.string().optional(),
    subject: z.string().min(1).max(998),
    html: z.string().max(100_000).optional(),
    text: z.string().max(100_000).optional(),
  })
  .refine((d) => Boolean(d.to) || Boolean(d.toUserId), {
    message: "Destinataire requis (to ou toUserId)",
  })
  .refine((d) => Boolean(d.html) || Boolean(d.text), {
    message: "Corps de l'email requis (html ou text)",
  });

/**
 * Sanitize minimal du HTML d'email : retire script/style/iframe/handlers on* et
 * neutralise les schémas dangereux (javascript:/data:text/html/vbscript:).
 */
function sanitizeEmailHtml(html: string): string {
  return html
    // Retire les blocs script/style/iframe/object/embed (contenu compris)
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, "")
    // Retire les handlers d'événements on*="..."
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    // Neutralise javascript:, data:text/html et vbscript: dans href/src
    .replace(/(href|src)\s*=\s*"\s*(javascript|vbscript|data\s*:\s*text\/html)[^"]*"/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*'\s*(javascript|vbscript|data\s*:\s*text\/html)[^']*'/gi, "$1='#'");
}

/** Validation, interpolation et résolution du destinataire (lecture seule). */
async function prepare(actionConfig: Record<string, unknown>, ctx: ExecutionContext) {
  const cfg = (actionConfig ?? {}) as {
    to?: string;
    toUserId?: string;
    subject?: string;
    html?: string;
    text?: string;
  };
  if (!cfg.to && !cfg.toUserId) throw new Error("Destinataire de l'email manquant");
  if (!cfg.subject) throw new Error("Objet de l'email manquant");
  if (!cfg.html && !cfg.text) throw new Error("Corps de l'email manquant");

  const html = sanitizeEmailHtml(interpolate(cfg.html ?? cfg.text ?? "", ctx));
  const text = cfg.text ? interpolate(cfg.text, ctx) : undefined;
  const subject = interpolate(cfg.subject, ctx);

  // `toUserId` (interpolé) prime : on résout l'email en base. Sinon `to`.
  let to: string;
  if (cfg.toUserId) {
    const userId = interpolate(cfg.toUserId, ctx);
    if (!z.string().uuid().safeParse(userId).success) {
      throw new Error("Destinataire (toUserId) invalide après interpolation");
    }
    const [u] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u?.email) throw new Error("Destinataire (toUserId) introuvable");
    to = u.email;
  } else {
    to = interpolate(cfg.to ?? "", ctx);
  }

  // Re-validation post-interpolation : empêche un placeholder {{cells.x}} de
  // détourner le destinataire (relais email arbitraire).
  const emailParse = z.string().email().safeParse(to);
  if (!emailParse.success) {
    throw new Error("Destinataire d'email invalide après interpolation");
  }
  return { to: emailParse.data, subject, html, text };
}

export const sendEmailAction: ActionDefinition = {
  type: "send_email",
  configSchema,
  async execute(actionConfig, _automation, ctx) {
    const mail = await prepare(actionConfig, ctx);
    const result = await sendEmail(mail);
    if (!result.success) {
      throw new Error(result.error ?? "Échec de l'envoi d'email");
    }
  },
  async simulate(actionConfig, _automation, ctx) {
    const { to, subject } = await prepare(actionConfig, ctx);
    return { emailSent: { to, subject }, simulated: true };
  },
};
