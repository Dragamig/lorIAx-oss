import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mailMessages } from "@/lib/db/schema-mailing";
import { sanitizeRagContent } from "@/lib/ai/sanitize-content";
import type { ChatToolContext } from "./context";
import { withToolLog } from "./tool-log";

const MAIL_DEFAULT_LIMIT = 10;
const MAIL_MAX_LIMIT = 20;

/** Libellé usager d'un statut d'envoi, repris de l'onglet Mails. */
const STATUS_LABELS: Record<string, string> = {
  scheduled: "programmé (délai d'annulation en cours)",
  sending: "en cours d'envoi",
  sent: "envoyé",
  failed: "échec",
  cancelled: "annulé",
};

/** Échappe les jokers LIKE d'une saisie du modèle. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Mails envoyés par l'utilisateur de la session, et lui seul : la boîte est
 * personnelle (administrateur compris), comme l'onglet Mails. Identité et
 * organisation viennent du contexte, jamais d'un argument du modèle.
 */
export function buildMailTools(ctx: ChatToolContext) {
  const list_my_mails = tool({
    description:
      "Liste les mails que l'utilisateur a envoyés depuis LorIAx (onglet Mails du CRM), du plus récent au plus ancien, avec leur statut d'envoi (envoyé, programmé, en cours, échec, annulé) et s'ils sont tracés dans Interactions. Filtre optionnel `search` sur l'adresse d'un destinataire ou l'objet : pour un nom de personne, chercher d'abord son adresse dans la base Contacts, puis appeler cet outil avec l'adresse (ou le nom de domaine).",
    inputSchema: z.object({
      search: z.string().trim().min(2).max(200).optional().describe("Adresse, domaine ou mot de l'objet"),
      limit: z.number().int().min(1).optional(),
    }),
    execute: withToolLog(ctx, "list_my_mails", async ({ search, limit }) => {
      const n = Math.min(limit ?? MAIL_DEFAULT_LIMIT, MAIL_MAX_LIMIT);
      const conds = [
        eq(mailMessages.organizationId, ctx.orgId),
        eq(mailMessages.userId, ctx.user.id),
        eq(mailMessages.direction, "out"),
      ];
      if (search) {
        const p = likePattern(search);
        conds.push(
          or(
            ilike(mailMessages.subject, p),
            sql`array_to_string(${mailMessages.toAddresses} || ${mailMessages.ccAddresses}, ' ') ILIKE ${p}`,
          )!,
        );
      }
      const rows = await db
        .select({
          subject: mailMessages.subject,
          to: mailMessages.toAddresses,
          cc: mailMessages.ccAddresses,
          status: mailMessages.status,
          scheduledAt: mailMessages.scheduledAt,
          sentAt: mailMessages.sentAt,
          createdAt: mailMessages.createdAt,
          lastError: mailMessages.lastError,
          interactionRowId: mailMessages.interactionRowId,
        })
        .from(mailMessages)
        .where(and(...conds))
        .orderBy(desc(mailMessages.createdAt))
        .limit(n);

      return {
        mails: rows.map((r) => ({
          subject: sanitizeRagContent(r.subject, 200),
          to: r.to.map((a) => sanitizeRagContent(a, 320)),
          cc: r.cc.map((a) => sanitizeRagContent(a, 320)),
          status: STATUS_LABELS[r.status] ?? r.status,
          createdAt: r.createdAt?.toISOString() ?? null,
          sentAt: r.sentAt?.toISOString() ?? null,
          scheduledAt: r.scheduledAt?.toISOString() ?? null,
          error:
            r.status === "failed"
              ? r.lastError === "delivery_unknown"
                ? "remise incertaine : vérifier le dossier Envoyés de la boîte mail"
                : sanitizeRagContent(r.lastError ?? "", 200)
              : null,
          tracedInInteractions: r.interactionRowId !== null,
        })),
        truncated: rows.length === n,
      };
    }),
  });

  return { list_my_mails };
}
