/**
 * Application au clic d'une proposition de création (tableur, document, présentation).
 * Identité et organisation viennent de la session ; le payload stocké est re-validé par zod, jamais appliqué
 * tel quel ; l'interrupteur du type, le module Présentations et le droit éditeur sur l'espace effectif sont
 * revérifiés à cet instant ; la transition `pending` vers `applying` est atomique (un seul clic gagne).
 */
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentCollabStates,
  documentComments,
  documents,
  presentations,
  spreadsheetData,
} from "@/lib/db/schema";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { getChatActionsSettings, PROPOSAL_TYPE_DISABLED_MESSAGE } from "@/lib/ai/chat-actions-settings";
import { guardPresentationsModuleForOrg } from "@/lib/presentations/guards";
import { isQuotaExceeded } from "@/lib/rate-limit";
import { createDocument } from "@/lib/documents/create-document";
import { createSpreadsheetDocument } from "@/lib/documents/create-spreadsheet-document";
import { createPresentation } from "@/lib/presentations/create-presentation";
import { buildDeckFromOutline } from "@/lib/presentations/build-deck-from-outline";
import { listKeys, deleteFile } from "@/lib/storage/s3";
import { presentationKey, revisionPrefix } from "@/lib/presentations/versioned-write";
import logger from "@/lib/logger";
import type { SessionUser } from "@/types";
import type { AiCreationKind } from "@/lib/db/schema-ai-creation-proposals";
import {
  claimForApply,
  getOwnCreationProposal,
  markApplied,
  markFailed,
  markUndone,
  recordOverrides,
} from "./store";
import {
  creationOverridesSchema,
  documentProposalSchema,
  presentationProposalSchema,
  spreadsheetProposalSchema,
  type CreationOverrides,
} from "./schemas";

export const CREATION_REFUSED_MESSAGE = "Cette proposition ne peut plus être appliquée";
export const CREATION_SPACE_DENIED_MESSAGE = "Vous n'avez plus le droit d'éditer cet espace";
export const CREATION_QUOTA_MESSAGE = "Trop de créations récentes, réessayez plus tard";
export const CREATION_FAILED_MESSAGE = "La création a échoué, aucun fichier n'a été conservé";
export const CREATION_UNDO_CHANGED_MESSAGE = "L'objet a été modifié depuis sa création, annulation impossible";

/** Créations appliquées par utilisateur : 30 par heure. */
const APPLY_TIERS: Parameters<typeof isQuotaExceeded>[1] = [{ maxRequests: 30, windowMs: 60 * 60 * 1000 }];

const FLAG = {
  spreadsheet: "proposeSpreadsheets",
  document: "proposeDocuments",
  presentation: "proposePresentations",
} as const;

/** Réponse client : aucune clé de stockage, aucun chemin de fichier. */
export type CreationResultDto = {
  id: string;
  kind: AiCreationKind;
  resultType: "document" | "presentation";
  spaceId: string;
  title: string;
};

export type CreationApplyOutcome =
  | { status: "applied"; result: CreationResultDto }
  | { status: "not_found" }
  | { status: "invalid"; message: string }
  | { status: "refused"; message: string }
  | { status: "failed"; message: string };

type Common = { spaceId: string; title: string; parentId?: string };

async function canEditSpace(
  user: SessionUser,
  orgId: string,
  spaceId: string,
  req?: NextRequest,
): Promise<boolean> {
  try {
    const s = await requireOrgScoped(
      { resource: { type: "space", id: spaceId }, minPermission: "editor" },
      req,
      { user, orgId },
    );
    if (s.orgId !== orgId || s.spaceId !== spaceId) return false;
    return s.permission === "editor" || s.permission === "admin";
  } catch (e) {
    if (e instanceof OrgScopeError) return false;
    throw e;
  }
}

function mergeOverrides(kind: AiCreationKind, payload: Record<string, unknown>, o: CreationOverrides) {
  const merged: Record<string, unknown> = { ...payload };
  if (o.title) merged.title = o.title;
  if (o.spaceId && o.spaceId !== payload.spaceId) {
    merged.spaceId = o.spaceId;
    delete merged.parentId; // le dossier parent appartient à l'ancien espace
  }
  if (o.columns) {
    if (kind !== "spreadsheet") return null;
    merged.columns = o.columns;
  }
  if (o.outline) {
    if (kind !== "document") return null;
    merged.outline = o.outline;
  }
  if (o.slideTitles) {
    if (kind !== "presentation") return null;
    const slides = (payload.slides as { title: string }[]) ?? [];
    if (o.slideTitles.length > slides.length) return null;
    merged.slides = slides.map((s, i) => ({ ...s, title: o.slideTitles![i] ?? s.title }));
  }
  return merged;
}

function documentMarkdown(p: { outline: { heading: string; level: number; summary?: string }[]; bodyMarkdown?: string }) {
  if (p.bodyMarkdown) return p.bodyMarkdown;
  return p.outline
    .map((i) => `${"#".repeat(i.level)} ${i.heading}\n${i.summary ? `\n${i.summary}\n` : ""}`)
    .join("\n");
}

async function parentInSpace(parentId: string, spaceId: string): Promise<boolean> {
  const [p] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.id, parentId), eq(documents.spaceId, spaceId)))
    .limit(1);
  return !!p;
}

export async function applyCreation(args: {
  proposalId: string;
  user: SessionUser;
  orgId: string;
  overrides?: unknown;
  req?: NextRequest;
}): Promise<CreationApplyOutcome> {
  const { user, orgId, req } = args;
  const proposal = await getOwnCreationProposal(orgId, user.id, args.proposalId);
  if (!proposal) return { status: "not_found" };
  if (proposal.status !== "pending") return { status: "refused", message: CREATION_REFUSED_MESSAGE };
  const kind = proposal.kind;

  const settings = await getChatActionsSettings(orgId);
  if (!settings[FLAG[kind]]) return { status: "refused", message: PROPOSAL_TYPE_DISABLED_MESSAGE };
  if (kind === "presentation" && (await guardPresentationsModuleForOrg(proposal.orgId))) {
    return { status: "refused", message: PROPOSAL_TYPE_DISABLED_MESSAGE };
  }

  let overrides: CreationOverrides = {};
  if (args.overrides !== undefined) {
    const o = creationOverridesSchema.safeParse(args.overrides);
    if (!o.success) return { status: "invalid", message: "Modifications invalides" };
    overrides = o.data;
  }
  const merged = mergeOverrides(kind, (proposal.payload ?? {}) as Record<string, unknown>, overrides);
  if (!merged) return { status: "invalid", message: "Modifications invalides" };

  const schema =
    kind === "spreadsheet"
      ? spreadsheetProposalSchema
      : kind === "document"
        ? documentProposalSchema
        : presentationProposalSchema;
  const parsed = schema.safeParse(merged);
  if (!parsed.success) return { status: "invalid", message: "Proposition invalide" };
  const data: Common = parsed.data;

  if (!(await canEditSpace(user, orgId, data.spaceId, req))) {
    return { status: "refused", message: CREATION_SPACE_DENIED_MESSAGE };
  }
  if (data.parentId && kind !== "presentation" && !(await parentInSpace(data.parentId, data.spaceId))) {
    return { status: "refused", message: CREATION_SPACE_DENIED_MESSAGE };
  }
  if (await isQuotaExceeded(`creation-apply:${user.id}`, APPLY_TIERS)) {
    return { status: "refused", message: CREATION_QUOTA_MESSAGE };
  }

  if (!(await claimForApply(proposal.id))) return { status: "refused", message: CREATION_REFUSED_MESSAGE };

  try {
    if (Object.keys(overrides).length > 0) await recordOverrides(proposal.id, overrides);
    const base = {
      spaceId: data.spaceId,
      title: data.title,
      createdBy: user.id,
    };
    let result: CreationResultDto;
    if (kind === "spreadsheet") {
      const p = parsed.data as ReturnType<typeof spreadsheetProposalSchema.parse>;
      const { document } = await createSpreadsheetDocument({
        ...base,
        parentId: p.parentId,
        visibility: "private",
        authorName: user.name,
        authorEmail: user.email,
        activitySource: "ai_chat",
        data: { columns: p.columns, rows: p.rows, sheetTitle: p.sheetTitle },
      });
      result = { id: document.id, kind, resultType: "document", spaceId: document.spaceId, title: document.title };
    } else if (kind === "document") {
      const p = parsed.data as ReturnType<typeof documentProposalSchema.parse>;
      const document = await createDocument({
        ...base,
        parentId: p.parentId,
        visibility: "private",
        authorName: user.name,
        authorEmail: user.email,
        activitySource: "ai_chat",
        content: documentMarkdown(p),
      });
      result = { id: document.id, kind, resultType: "document", spaceId: document.spaceId, title: document.title };
    } else {
      const p = parsed.data as ReturnType<typeof presentationProposalSchema.parse>;
      const created = await createPresentation({
        ...base,
        deck: buildDeckFromOutline(p.title, p.slides),
      });
      result = {
        id: created.id,
        kind,
        resultType: "presentation",
        spaceId: created.spaceId ?? data.spaceId,
        title: created.title,
      };
    }
    await markAppliedWithRetry(proposal.id, result);
    return { status: "applied", result };
  } catch (err) {
    logger.error({ err: String(err), proposalId: proposal.id }, "[creation] application échouée");
    await cleanupOrphan(err);
    await markFailed(proposal.id);
    return { status: "failed", message: CREATION_FAILED_MESSAGE };
  }
}

/**
 * L'objet existe déjà : un échec d'écriture du statut ne doit ni le passer en `failed` ni autoriser un
 * doublon. Trois essais ; au-delà, l'erreur est journalisée et la proposition reste `applying` (sans
 * `result_id`, donc reprenable seulement par un administrateur après contrôle, le résultat est renvoyé).
 */
async function markAppliedWithRetry(proposalId: string, result: CreationResultDto): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await markApplied(proposalId, result.id, result.resultType);
      return;
    } catch (err) {
      logger.error({ err: String(err), proposalId, attempt }, "[creation] markApplied échoué");
    }
  }
  logger.error({ proposalId, resultId: result.id }, "[creation] objet créé mais statut non enregistré");
}

/** Une présentation dont l'objet S3 n'a pas pu être écrit laisse une ligne : on la retire. */
async function cleanupOrphan(err: unknown): Promise<void> {
  const presentationId = (err as { presentationId?: string } | null)?.presentationId;
  if (!presentationId) return;
  try {
    await db.delete(presentations).where(eq(presentations.id, presentationId));
    for (const key of await listKeys(revisionPrefix(presentationId))) await deleteFile(key);
    await deleteFile(presentationKey(presentationId));
  } catch (cleanupErr) {
    logger.error({ err: String(cleanupErr), presentationId }, "[creation] nettoyage de l'orpheline incomplet");
  }
}

export type CreationUndoOutcome =
  | { status: "undone" }
  | { status: "not_found" }
  | { status: "refused"; message: string };

/** L'objet est supprimé : un échec d'écriture du statut est journalisé, il ne remet pas en cause l'annulation. */
async function markUndoneSafe(proposalId: string, orgId: string, userId: string): Promise<void> {
  try {
    await markUndone(proposalId, orgId, userId);
  } catch (err) {
    logger.error({ err: String(err), proposalId }, "[creation] markUndone échoué");
  }
}

const SHEET_ID = /sheetid="([^"]+)"/i;

/**
 * Annulation : supprime l'objet créé tant qu'il n'a pas été modifié depuis sa création
 * (`updatedAt` égal à `createdAt`, feuille du tableur comprise). Aucune corbeille n'existe pour ces objets.
 */
export async function undoCreation(args: {
  proposalId: string;
  user: SessionUser;
  orgId: string;
  req?: NextRequest;
}): Promise<CreationUndoOutcome> {
  const { user, orgId, req } = args;
  const proposal = await getOwnCreationProposal(orgId, user.id, args.proposalId);
  if (!proposal) return { status: "not_found" };
  if (proposal.status !== "applied" || !proposal.resultId) {
    return { status: "refused", message: "Cette création ne peut pas être annulée" };
  }
  const id = proposal.resultId;

  if (proposal.resultType === "presentation") {
    const [obj] = await db
      .select({
        id: presentations.id,
        spaceId: presentations.spaceId,
        createdAt: presentations.createdAt,
        updatedAt: presentations.updatedAt,
      })
      .from(presentations)
      .where(eq(presentations.id, id))
      .limit(1);
    if (!obj || !obj.spaceId) return { status: "refused", message: "Objet déjà supprimé" };
    if (!(await canEditSpace(user, orgId, obj.spaceId, req))) {
      return { status: "refused", message: CREATION_SPACE_DENIED_MESSAGE };
    }
    if (obj.updatedAt.getTime() > obj.createdAt.getTime()) {
      return { status: "refused", message: CREATION_UNDO_CHANGED_MESSAGE };
    }
    await db.delete(presentations).where(eq(presentations.id, id));
    try {
      for (const key of await listKeys(revisionPrefix(id))) await deleteFile(key);
      await deleteFile(presentationKey(id));
    } catch (err) {
      logger.error({ err: String(err), id }, "[creation] nettoyage S3 incomplet");
    }
    await markUndoneSafe(proposal.id, orgId, user.id);
    return { status: "undone" };
  }

  const [doc] = await db
    .select({
      id: documents.id,
      spaceId: documents.spaceId,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      contentText: documents.contentText,
    })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  if (!doc) return { status: "refused", message: "Objet déjà supprimé" };
  if (!(await canEditSpace(user, orgId, doc.spaceId, req))) {
    return { status: "refused", message: CREATION_SPACE_DENIED_MESSAGE };
  }
  if (doc.updatedAt.getTime() > doc.createdAt.getTime()) {
    return { status: "refused", message: CREATION_UNDO_CHANGED_MESSAGE };
  }
  const sheetId = proposal.kind === "spreadsheet" ? SHEET_ID.exec(doc.contentText ?? "")?.[1] : undefined;
  if (sheetId) {
    const [sheet] = await db
      .select({ updatedAt: spreadsheetData.updatedAt })
      .from(spreadsheetData)
      .where(eq(spreadsheetData.sheetId, sheetId))
      .limit(1);
    if (sheet && sheet.updatedAt.getTime() > doc.createdAt.getTime()) {
      return { status: "refused", message: CREATION_UNDO_CHANGED_MESSAGE };
    }
  }
  // L'édition collaborative écrit dans la table Yjs sans toucher `documents.updatedAt`. Un état Yjs existe
  // dès la création (graine du contenu) : seul un état écrit après l'application prouve une modification.
  const [collab] = await db
    .select({ updatedAt: documentCollabStates.updatedAt })
    .from(documentCollabStates)
    .where(eq(documentCollabStates.documentId, id))
    .limit(1);
  if (collab && (!proposal.appliedAt || collab.updatedAt.getTime() > proposal.appliedAt.getTime())) {
    return { status: "refused", message: CREATION_UNDO_CHANGED_MESSAGE };
  }
  const [child] = await db.select({ id: documents.id }).from(documents).where(eq(documents.parentId, id)).limit(1);
  if (child) return { status: "refused", message: CREATION_UNDO_CHANGED_MESSAGE };
  const [comment] = await db
    .select({ id: documentComments.id })
    .from(documentComments)
    .where(eq(documentComments.documentId, id))
    .limit(1);
  if (comment) return { status: "refused", message: CREATION_UNDO_CHANGED_MESSAGE };
  await db.delete(documents).where(eq(documents.id, id));
  if (sheetId) await db.delete(spreadsheetData).where(eq(spreadsheetData.sheetId, sheetId));
  await markUndoneSafe(proposal.id, orgId, user.id);
  return { status: "undone" };
}
