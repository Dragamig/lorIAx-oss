import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { media, mediaFolders } from "@/lib/db/schema";
import { logActivity } from "@/lib/activity";
import { isOrgAdminOrOwner } from "@/lib/media/access";
import { canCrossOrgBoundary } from "@/lib/auth/rbac";
import { isOrgMember } from "@/lib/org/resolve-request-org";
import { listableMediaCondition } from "@/lib/media/list";
import type { SessionUser } from "@/types";

export type FolderNode = {
  id: string;
  parentId: string | null;
  name: string;
  mediaCount: number;
};

export type FolderErrorStatus = 400 | 403 | 404 | 409;

export class FolderError extends Error {
  status: FolderErrorStatus;
  constructor(status: FolderErrorStatus, message: string) {
    super(message);
    this.name = "FolderError";
    this.status = status;
  }
}

export const FOLDER_NAME_MAX = 200;
const WRITE_ROLES = new Set(["admin", "editor"]);

type FolderRow = { id: string; parentId: string | null; name: string };

/**
 * Écriture : `super_admin` (franchit les organisations), admin/owner de
 * l'organisation, ou rôle global editor/admin exercé DANS une organisation
 * dont l'utilisateur est membre (le rôle global n'ouvre jamais l'écriture
 * chez un tenant tiers).
 */
export async function canWriteLibrary(user: SessionUser, orgId: string): Promise<boolean> {
  if (canCrossOrgBoundary(user.globalRole)) return true;
  if (await isOrgAdminOrOwner(user.id, orgId)) return true;
  if (!WRITE_ROLES.has(user.globalRole)) return false;
  return isOrgMember(user.id, orgId);
}

async function assertCanWrite(user: SessionUser, orgId: string): Promise<void> {
  if (await canWriteLibrary(user, orgId)) return;
  throw new FolderError(403, "Droits insuffisants pour modifier les dossiers");
}

function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new FolderError(400, "Nom de dossier requis");
  const name = raw.trim();
  if (name.length === 0) throw new FolderError(400, "Nom de dossier requis");
  if (name.length > FOLDER_NAME_MAX) {
    throw new FolderError(400, `Nom de dossier trop long (${FOLDER_NAME_MAX} caractères au plus)`);
  }
  return name;
}

async function loadFolders(orgId: string): Promise<FolderRow[]> {
  return db
    .select({ id: mediaFolders.id, parentId: mediaFolders.parentId, name: mediaFolders.name })
    .from(mediaFolders)
    .where(eq(mediaFolders.organizationId, orgId));
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

function assertNoSibling(
  all: FolderRow[],
  parentId: string | null,
  name: string,
  ignoreId?: string
): void {
  const key = name.toLocaleLowerCase();
  const clash = all.some(
    (f) =>
      f.id !== ignoreId && f.parentId === parentId && f.name.toLocaleLowerCase() === key
  );
  if (clash) throw new FolderError(409, "Un dossier de ce nom existe déjà à cet endroit");
}

function findOrThrow(all: FolderRow[], id: string): FolderRow {
  const f = all.find((x) => x.id === id);
  if (!f) throw new FolderError(404, "Dossier introuvable");
  return f;
}

function assertValidParent(all: FolderRow[], id: string, parentId: string | null): void {
  if (!parentId) return;
  findOrThrow(all, parentId);
  // Remonter depuis la cible : si l'on croise le dossier déplacé, c'est un descendant.
  const byId = new Map(all.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (let cur: string | null = parentId; cur; cur = byId.get(cur)?.parentId ?? null) {
    if (cur === id) throw new FolderError(400, "Un dossier ne peut pas être déplacé dans lui-même ou l'un de ses sous-dossiers");
    if (seen.has(cur)) break;
    seen.add(cur);
  }
}

/** Arbre plat de l'organisation, `mediaCount` limité aux médias visibles de l'utilisateur. */
export async function listFolders(user: SessionUser, orgId: string): Promise<FolderNode[]> {
  const [folders, visible] = await Promise.all([
    loadFolders(orgId),
    listableMediaCondition(user, orgId, "live"),
  ]);
  const counts = await db
    .select({ folderId: media.folderId, n: sql<number>`count(*)::int` })
    .from(media)
    .where(and(visible, isNotNull(media.folderId)))
    .groupBy(media.folderId);
  const byFolder = new Map<string, number>();
  for (const c of counts) if (c.folderId) byFolder.set(c.folderId, Number(c.n));
  return folders
    .map((f) => ({ ...f, mediaCount: byFolder.get(f.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export async function createFolder(
  user: SessionUser,
  orgId: string,
  input: { name: unknown; parentId?: string | null }
): Promise<FolderNode> {
  await assertCanWrite(user, orgId);
  const name = cleanName(input.name);
  const parentId = input.parentId ?? null;
  const all = await loadFolders(orgId);
  if (parentId) findOrThrow(all, parentId);
  assertNoSibling(all, parentId, name);
  try {
    const [row] = await db
      .insert(mediaFolders)
      .values({ organizationId: orgId, parentId, name, createdBy: user.id })
      .returning({ id: mediaFolders.id });
    await logActivity({
      userId: user.id,
      action: "folder.created",
      entityType: "media",
      entityId: row.id,
      metadata: { name, parentId },
    });
    return { id: row.id, parentId, name, mediaCount: 0 };
  } catch (e) {
    if (isUniqueViolation(e)) throw new FolderError(409, "Un dossier de ce nom existe déjà à cet endroit");
    throw e;
  }
}

export async function renameFolder(
  user: SessionUser,
  orgId: string,
  id: string,
  rawName: unknown
): Promise<FolderRow> {
  await assertCanWrite(user, orgId);
  const name = cleanName(rawName);
  const all = await loadFolders(orgId);
  const folder = findOrThrow(all, id);
  assertNoSibling(all, folder.parentId, name, id);
  try {
    await db
      .update(mediaFolders)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(mediaFolders.id, id), eq(mediaFolders.organizationId, orgId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new FolderError(409, "Un dossier de ce nom existe déjà à cet endroit");
    throw e;
  }
  await logActivity({
    userId: user.id,
    action: "folder.renamed",
    entityType: "media",
    entityId: id,
    metadata: { from: folder.name, to: name },
  });
  return { id, parentId: folder.parentId, name };
}

export async function moveFolder(
  user: SessionUser,
  orgId: string,
  id: string,
  parentId: string | null
): Promise<FolderRow> {
  await assertCanWrite(user, orgId);
  const all = await loadFolders(orgId);
  const folder = findOrThrow(all, id);
  assertValidParent(all, id, parentId);
  assertNoSibling(all, parentId, folder.name, id);
  try {
    await db
      .update(mediaFolders)
      .set({ parentId, updatedAt: new Date() })
      .where(and(eq(mediaFolders.id, id), eq(mediaFolders.organizationId, orgId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new FolderError(409, "Un dossier de ce nom existe déjà à cet endroit");
    throw e;
  }
  await logActivity({
    userId: user.id,
    action: "folder.moved",
    entityType: "media",
    entityId: id,
    metadata: { from: folder.parentId, to: parentId },
  });
  return { id, parentId, name: folder.name };
}

/** Renomme et/ou déplace en une seule écriture, après validation des deux changements. */
export async function updateFolder(
  user: SessionUser,
  orgId: string,
  id: string,
  input: { name?: unknown; parentId?: string | null }
): Promise<FolderRow> {
  await assertCanWrite(user, orgId);
  const hasName = input.name !== undefined;
  const hasParent = input.parentId !== undefined;
  const name = hasName ? cleanName(input.name) : undefined;
  const all = await loadFolders(orgId);
  const folder = findOrThrow(all, id);
  const parentId = hasParent ? (input.parentId ?? null) : folder.parentId;
  if (hasParent) assertValidParent(all, id, parentId);
  const finalName = name ?? folder.name;
  assertNoSibling(all, parentId, finalName, id);
  try {
    await db
      .update(mediaFolders)
      .set({ ...(name !== undefined ? { name } : {}), parentId, updatedAt: new Date() })
      .where(and(eq(mediaFolders.id, id), eq(mediaFolders.organizationId, orgId)));
  } catch (e) {
    if (isUniqueViolation(e)) throw new FolderError(409, "Un dossier de ce nom existe déjà à cet endroit");
    throw e;
  }
  if (name !== undefined && name !== folder.name) {
    await logActivity({
      userId: user.id,
      action: "folder.renamed",
      entityType: "media",
      entityId: id,
      metadata: { from: folder.name, to: name },
    });
  }
  if (parentId !== folder.parentId) {
    await logActivity({
      userId: user.id,
      action: "folder.moved",
      entityType: "media",
      entityId: id,
      metadata: { from: folder.parentId, to: parentId },
    });
  }
  return { id, parentId, name: finalName };
}

/**
 * Supprime un dossier : sous-dossiers et médias remontent au parent, dans une
 * transaction (la contrainte `restrict` de `parent_id` n'est jamais heurtée).
 * Seul `folder_id` des médias change.
 */
export async function deleteFolder(
  user: SessionUser,
  orgId: string,
  id: string
): Promise<DeleteFolderResult> {
  await assertCanWrite(user, orgId);
  const all = await loadFolders(orgId);
  const folder = findOrThrow(all, id);
  const children = all.filter((f) => f.parentId === id);
  const parentSiblings = all.filter((f) => f.parentId === folder.parentId && f.id !== id);
  for (const c of children) {
    const key = c.name.toLocaleLowerCase();
    if (parentSiblings.some((s) => s.name.toLocaleLowerCase() === key)) {
      throw new FolderError(409, `Le dossier parent contient déjà un dossier « ${c.name} »`);
    }
  }

  const result = await db.transaction(async (tx) => {
    const movedKids = await tx
      .update(mediaFolders)
      .set({ parentId: folder.parentId, updatedAt: new Date() })
      .where(and(eq(mediaFolders.parentId, id), eq(mediaFolders.organizationId, orgId)))
      .returning({ id: mediaFolders.id });
    const movedMedia = await tx
      .update(media)
      .set({ folderId: folder.parentId })
      .where(and(eq(media.folderId, id), eq(media.organizationId, orgId)))
      .returning({ id: media.id });
    await tx
      .delete(mediaFolders)
      .where(and(eq(mediaFolders.id, id), eq(mediaFolders.organizationId, orgId)));
    return {
      movedMedia: movedMedia.length,
      movedChildren: movedKids.length,
      undo: {
        folderId: id,
        parentId: folder.parentId,
        name: folder.name,
        mediaIds: movedMedia.map((m) => m.id),
        childIds: movedKids.map((k) => k.id),
      },
    };
  });

  await logActivity({
    userId: user.id,
    action: "folder.deleted",
    entityType: "media",
    entityId: id,
    metadata: { name: folder.name, movedMedia: result.movedMedia, movedChildren: result.movedChildren },
  });
  return result;
}

export type FolderUndo = {
  folderId: string;
  parentId: string | null;
  name: string;
  mediaIds: string[];
  childIds: string[];
};

export type DeleteFolderResult = {
  movedMedia: number;
  movedChildren: number;
  undo: FolderUndo;
};

const UNDO_IDS_MAX = 10000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidList(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > UNDO_IDS_MAX || !raw.every((x) => typeof x === "string" && UUID.test(x))) {
    throw new FolderError(400, "Données d'annulation invalides");
  }
  return raw as string[];
}

/** Valide la charge `undo` rendue par `deleteFolder` (jamais de confiance au client). */
export function parseFolderUndo(raw: unknown): FolderUndo {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new FolderError(400, "Données d'annulation invalides");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.folderId !== "string" || !UUID.test(o.folderId)) {
    throw new FolderError(400, "Données d'annulation invalides");
  }
  const parentId = o.parentId === null || o.parentId === undefined ? null : o.parentId;
  if (parentId !== null && (typeof parentId !== "string" || !UUID.test(parentId))) {
    throw new FolderError(400, "Données d'annulation invalides");
  }
  return {
    folderId: o.folderId,
    parentId,
    name: cleanName(o.name),
    mediaIds: uuidList(o.mediaIds),
    childIds: uuidList(o.childIds),
  };
}

/**
 * Inverse de `deleteFolder` : recrée le dossier (même id) puis replace médias et
 * sous-dossiers, uniquement ceux qui sont encore chez l'ancien parent et dans
 * l'organisation. Mêmes droits que la suppression.
 */
export async function restoreFolder(
  user: SessionUser,
  orgId: string,
  rawUndo: unknown
): Promise<{ folder: FolderNode; restoredMedia: number; restoredChildren: number }> {
  await assertCanWrite(user, orgId);
  const undo = parseFolderUndo(rawUndo);
  const all = await loadFolders(orgId);
  if (all.some((f) => f.id === undo.folderId)) {
    throw new FolderError(409, "Ce dossier existe déjà");
  }
  if (undo.parentId) findOrThrow(all, undo.parentId);
  assertNoSibling(all, undo.parentId, undo.name);

  const result = await db.transaction(async (tx) => {
    await tx.insert(mediaFolders).values({
      id: undo.folderId,
      organizationId: orgId,
      parentId: undo.parentId,
      name: undo.name,
      createdBy: user.id,
    });
    const parentMatch = (col: typeof mediaFolders.parentId | typeof media.folderId) =>
      undo.parentId ? eq(col, undo.parentId) : isNull(col);
    const kids = undo.childIds.length
      ? await tx
          .update(mediaFolders)
          .set({ parentId: undo.folderId, updatedAt: new Date() })
          .where(
            and(
              inArray(mediaFolders.id, undo.childIds),
              eq(mediaFolders.organizationId, orgId),
              parentMatch(mediaFolders.parentId)
            )
          )
          .returning({ id: mediaFolders.id })
      : [];
    const meds = undo.mediaIds.length
      ? await tx
          .update(media)
          .set({ folderId: undo.folderId })
          .where(
            and(
              inArray(media.id, undo.mediaIds),
              eq(media.organizationId, orgId),
              parentMatch(media.folderId)
            )
          )
          .returning({ id: media.id })
      : [];
    return { restoredMedia: meds.length, restoredChildren: kids.length };
  }).catch((e: unknown) => {
    if (isUniqueViolation(e)) throw new FolderError(409, "Un dossier de ce nom existe déjà à cet endroit");
    throw e;
  });

  await logActivity({
    userId: user.id,
    action: "folder.restored",
    entityType: "media",
    entityId: undo.folderId,
    metadata: { name: undo.name, ...result },
  });
  return { folder: { id: undo.folderId, parentId: undo.parentId, name: undo.name, mediaCount: result.restoredMedia }, ...result };
}
