import { tool } from "ai";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { withToolLog } from "./tool-log";
import type { ChatToolContext } from "./context";
import { PROPOSAL_PENDING_MESSAGE } from "./write-tools";
import { createCreationProposal, countPendingCreationProposals } from "@/lib/ai/creation/store";
import { enrichPresentation } from "@/lib/ai/creation/enrich";
import {
  spreadsheetProposalSchema,
  documentProposalSchema,
  presentationProposalSchema,
} from "@/lib/ai/creation/schemas";
import type { AiCreationKind } from "@/lib/db/schema-ai-creation-proposals";
import { ALL_ON_CHAT_ACTIONS, type ChatActionsSettings } from "@/lib/ai/chat-actions-settings";

/** Message unique pour espace inconnu, autre organisation, droit insuffisant ou dossier parent invalide. */
const SPACE_DENIED = { error: "Espace introuvable ou accès refusé" } as const;

/** Plafond de propositions en attente par utilisateur. */
export const MAX_PENDING_CREATIONS = 20;
const TOO_MANY_PENDING = {
  error: `Vous avez déjà ${MAX_PENDING_CREATIONS} propositions de création en attente : validez ou ignorez-en avant d'en demander d'autres`,
} as const;

/**
 * Droit éditeur sur l'espace, confronté à l'organisation de la session
 * (requireOrgScoped), et dossier parent appartenant au même espace. Tout refus
 * est muet et identique.
 */
async function canCreateIn(ctx: ChatToolContext, spaceId: string, parentId?: string): Promise<boolean> {
  let scoped;
  try {
    scoped = await requireOrgScoped(
      { resource: { type: "space", id: spaceId }, minPermission: "editor" },
      ctx.req,
      { user: ctx.user, orgId: ctx.orgId },
    );
  } catch (e) {
    if (e instanceof OrgScopeError) return false;
    throw e;
  }
  if (scoped.orgId !== ctx.orgId || scoped.spaceId !== spaceId) return false;
  if (scoped.permission !== "editor" && scoped.permission !== "admin") return false;
  if (!parentId) return true;
  const [parent] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, parentId), eq(documents.spaceId, spaceId)))
    .limit(1);
  return !!parent;
}

async function record(
  ctx: ChatToolContext,
  kind: AiCreationKind,
  spaceId: string,
  payload: unknown,
) {
  if ((await countPendingCreationProposals(ctx.orgId, ctx.user.id)) >= MAX_PENDING_CREATIONS) {
    return TOO_MANY_PENDING;
  }
  const row = await createCreationProposal({
    orgId: ctx.orgId,
    userId: ctx.user.id,
    spaceId,
    kind,
    payload,
  });
  return { proposalId: row.id, message: PROPOSAL_PENDING_MESSAGE };
}

export function buildCreateTools(ctx: ChatToolContext, actions: ChatActionsSettings = ALL_ON_CHAT_ACTIONS) {
  const propose_create_spreadsheet = tool({
    description:
      "Propose la création d'un tableur (colonnes et lignes d'exemple). Ne crée rien : l'utilisateur doit valider la proposition.",
    inputSchema: spreadsheetProposalSchema,
    execute: withToolLog(ctx, "propose_create_spreadsheet", async (args) => {
      if (!(await canCreateIn(ctx, args.spaceId, args.parentId))) return SPACE_DENIED;
      return record(ctx, "spreadsheet", args.spaceId, args);
    }),
  });

  const propose_create_document = tool({
    description:
      "Propose la création d'un document à partir d'un plan. Ne crée rien : l'utilisateur doit valider la proposition.",
    inputSchema: documentProposalSchema,
    execute: withToolLog(ctx, "propose_create_document", async (args) => {
      if (!(await canCreateIn(ctx, args.spaceId, args.parentId))) return SPACE_DENIED;
      return record(ctx, "document", args.spaceId, args);
    }),
  });

  const propose_create_presentation = tool({
    description:
      "Propose la création d'une présentation à partir d'un plan de diapositives. Ne crée rien : l'utilisateur doit valider la proposition.",
    inputSchema: presentationProposalSchema,
    execute: withToolLog(ctx, "propose_create_presentation", async (args) => {
      if (!(await canCreateIn(ctx, args.spaceId, args.parentId))) return SPACE_DENIED;
      const enriched = await enrichPresentation(args, { orgId: ctx.orgId, userId: ctx.user.id });
      return record(ctx, "presentation", args.spaceId, enriched);
    }),
  });

  return {
    ...(actions.proposeSpreadsheets ? { propose_create_spreadsheet } : {}),
    ...(actions.proposeDocuments ? { propose_create_document } : {}),
    ...(actions.proposePresentations ? { propose_create_presentation } : {}),
  };
}
