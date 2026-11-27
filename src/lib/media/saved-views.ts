import { and, asc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaSavedViews } from "@/lib/db/schema-media-comfort";
import { isOrgAdminOrOwner } from "@/lib/media/access";
import { FilterError, parseMediaFilters, serializeMediaFilters } from "@/lib/media/filters";
import { isOrgMember } from "@/lib/org/resolve-request-org";
import type { SessionUser } from "@/types";

import { SAVED_VIEW_NAME_MAX, SAVED_VIEWS_PER_USER_MAX, type SavedViewDto } from "@/lib/media/saved-views-limits";

export { SAVED_VIEW_NAME_MAX, SAVED_VIEWS_PER_USER_MAX };
export type { SavedViewDto };

export type SavedViewErrorStatus = 400 | 403 | 404 | 409;

export class SavedViewError extends Error {
  status: SavedViewErrorStatus;
  constructor(status: SavedViewErrorStatus, message: string) {
    super(message);
    this.name = "SavedViewError";
    this.status = status;
  }
}

type Row = typeof mediaSavedViews.$inferSelect;

function toDto(row: Row, userId: string): SavedViewDto {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    shared: row.shared,
    mine: row.userId === userId,
  };
}

function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new SavedViewError(400, "Nom de vue requis");
  const name = raw.trim();
  if (name.length === 0) throw new SavedViewError(400, "Nom de vue requis");
  if (name.length > SAVED_VIEW_NAME_MAX) {
    throw new SavedViewError(400, `Nom de vue trop long (${SAVED_VIEW_NAME_MAX} caractères au plus)`);
  }
  return name;
}

/**
 * Valide la chaîne de filtres par le parseur strict des filtres de la médiathèque,
 * retire la pagination (cursor, limit) et renvoie la forme canonique.
 * Un filtre visant un espace ou un dossier inaccessible est accepté tel quel :
 * la liste des médias applique les droits au moment de l'affichage.
 */
export function normalizeViewQuery(raw: unknown): string {
  if (typeof raw !== "string") throw new SavedViewError(400, "Filtres invalides");
  if (raw.length > 2000) throw new SavedViewError(400, "Filtres trop longs");
  const params = new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
  params.delete("cursor");
  params.delete("limit");
  try {
    const parsed = parseMediaFilters(params);
    return serializeMediaFilters({ ...parsed, cursor: undefined, limit: undefined }).toString();
  } catch (e) {
    if (e instanceof FilterError) throw new SavedViewError(400, e.message);
    throw e;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

async function assertMember(user: SessionUser, orgId: string): Promise<void> {
  if (!(await isOrgMember(user.id, orgId))) throw new SavedViewError(403, "Accès refusé");
}

export async function listSavedViews(
  user: SessionUser,
  orgId: string,
): Promise<{ mine: SavedViewDto[]; shared: SavedViewDto[] }> {
  await assertMember(user, orgId);
  const rows = await db
    .select()
    .from(mediaSavedViews)
    .where(
      and(
        eq(mediaSavedViews.organizationId, orgId),
        or(eq(mediaSavedViews.userId, user.id), eq(mediaSavedViews.shared, true)),
      ),
    )
    .orderBy(asc(mediaSavedViews.name));
  const dtos = rows.map((r) => toDto(r, user.id));
  return { mine: dtos.filter((d) => d.mine), shared: dtos.filter((d) => !d.mine) };
}

export async function createSavedView(
  user: SessionUser,
  orgId: string,
  input: { name: unknown; query: unknown; shared?: unknown },
): Promise<SavedViewDto> {
  await assertMember(user, orgId);
  const name = cleanName(input.name);
  const query = normalizeViewQuery(input.query ?? "");
  if (input.shared !== undefined && typeof input.shared !== "boolean") {
    throw new SavedViewError(400, "Partage invalide");
  }
  const shared = input.shared === true;

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mediaSavedViews)
    .where(and(eq(mediaSavedViews.organizationId, orgId), eq(mediaSavedViews.userId, user.id)));
  if (n >= SAVED_VIEWS_PER_USER_MAX) {
    throw new SavedViewError(409, `Limite atteinte : ${SAVED_VIEWS_PER_USER_MAX} vues au plus`);
  }

  try {
    const [row] = await db
      .insert(mediaSavedViews)
      .values({ organizationId: orgId, userId: user.id, name, query, shared })
      .returning();
    return toDto(row, user.id);
  } catch (e) {
    if (isUniqueViolation(e)) throw new SavedViewError(409, "Une vue porte déjà ce nom");
    throw e;
  }
}

/** Auteur, ou admin/owner de l'organisation pour une vue partagée. Sinon 404 muet. */
async function loadWritable(user: SessionUser, orgId: string, id: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(mediaSavedViews)
    .where(and(eq(mediaSavedViews.id, id), eq(mediaSavedViews.organizationId, orgId)));
  const notFound = new SavedViewError(404, "Vue introuvable");
  if (!row) throw notFound;
  if (row.userId === user.id) return row;
  if (row.shared && (await isOrgAdminOrOwner(user.id, orgId))) return row;
  throw notFound;
}

export async function updateSavedView(
  user: SessionUser,
  orgId: string,
  id: string,
  patch: { name?: unknown; shared?: unknown; query?: unknown },
): Promise<SavedViewDto> {
  await assertMember(user, orgId);
  const set: Partial<Pick<Row, "name" | "shared" | "query">> = {};
  if (patch.name !== undefined) set.name = cleanName(patch.name);
  if (patch.query !== undefined) set.query = normalizeViewQuery(patch.query);
  if (patch.shared !== undefined) {
    if (typeof patch.shared !== "boolean") throw new SavedViewError(400, "Partage invalide");
    set.shared = patch.shared;
  }
  if (Object.keys(set).length === 0) throw new SavedViewError(400, "Rien à modifier");

  await loadWritable(user, orgId, id);
  try {
    const [row] = await db
      .update(mediaSavedViews)
      .set(set)
      .where(and(eq(mediaSavedViews.id, id), eq(mediaSavedViews.organizationId, orgId)))
      .returning();
    if (!row) throw new SavedViewError(404, "Vue introuvable");
    return toDto(row, user.id);
  } catch (e) {
    if (isUniqueViolation(e)) throw new SavedViewError(409, "Une vue porte déjà ce nom");
    throw e;
  }
}

export async function deleteSavedView(user: SessionUser, orgId: string, id: string): Promise<void> {
  await assertMember(user, orgId);
  await loadWritable(user, orgId, id);
  await db
    .delete(mediaSavedViews)
    .where(and(eq(mediaSavedViews.id, id), eq(mediaSavedViews.organizationId, orgId)));
}
