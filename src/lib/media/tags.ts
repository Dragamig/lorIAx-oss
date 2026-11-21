import { and, eq, inArray, sql } from "drizzle-orm";
import slugify from "slugify";
import { db } from "@/lib/db";
import { media, mediaTagLinks, mediaTags } from "@/lib/db/schema";
import { canWriteLibrary } from "@/lib/media/folders";
import { visibleMediaCondition } from "@/lib/media/list";
import type { SessionUser } from "@/types";

export type TagErrorStatus = 400 | 403;

export class TagError extends Error {
  status: TagErrorStatus;
  constructor(status: TagErrorStatus, message: string) {
    super(message);
    this.name = "TagError";
    this.status = status;
  }
}

export const TAG_LABEL_MAX = 120;
export const MEDIA_TAGS_MAX = 20;

type TagRow = { id: string; label: string };
type Executor = Pick<typeof db, "select" | "insert">;

export function tagSlug(label: string): string {
  return slugify(label, { lower: true, strict: true }).slice(0, TAG_LABEL_MAX);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}

/** Tags de l'organisation portés par au moins un média visible (ou par aucun média). */
export async function listTags(
  user: SessionUser,
  orgId: string
): Promise<{ id: string; label: string; count: number }[]> {
  const visible = await visibleMediaCondition(user, orgId, "live");
  const rows = await db
    .select({
      id: mediaTags.id,
      label: mediaTags.label,
      n: sql<number>`count(${media.id}) filter (where ${visible})::int`,
      total: sql<number>`count(${mediaTagLinks.mediaId})::int`,
    })
    .from(mediaTags)
    .leftJoin(mediaTagLinks, eq(mediaTagLinks.tagId, mediaTags.id))
    .leftJoin(media, eq(media.id, mediaTagLinks.mediaId))
    .where(eq(mediaTags.organizationId, orgId))
    .groupBy(mediaTags.id, mediaTags.label);
  // Un tag porté seulement par des médias invisibles ne doit pas fuiter.
  return rows
    .filter((r) => Number(r.n) > 0 || Number(r.total) === 0)
    .map((r) => ({ id: r.id, label: r.label, count: Number(r.n) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/**
 * Crée à la volée les tags manquants (unicité par slug, le libellé du premier
 * créateur est conservé) et rend un tag par slug distinct, dans l'ordre d'entrée.
 */
export async function ensureTags(
  orgId: string,
  labels: string[],
  tx: Executor = db
): Promise<TagRow[]> {
  const bySlug = new Map<string, string>();
  for (const raw of labels) {
    const label = String(raw ?? "").trim();
    if (!label) continue;
    if (label.length > TAG_LABEL_MAX) {
      throw new TagError(400, `Tag trop long (${TAG_LABEL_MAX} caractères au plus)`);
    }
    const slug = tagSlug(label);
    if (!slug) throw new TagError(400, "Tag invalide");
    if (!bySlug.has(slug)) bySlug.set(slug, label);
  }
  if (bySlug.size > MEDIA_TAGS_MAX) {
    throw new TagError(400, `${MEDIA_TAGS_MAX} tags au plus par média`);
  }
  const slugs = [...bySlug.keys()];
  if (slugs.length === 0) return [];

  const readExisting = () =>
    tx
      .select({ id: mediaTags.id, label: mediaTags.label, slug: mediaTags.slug })
      .from(mediaTags)
      .where(and(eq(mediaTags.organizationId, orgId), inArray(mediaTags.slug, slugs)));

  const found = new Map<string, TagRow>();
  for (const r of await readExisting()) found.set(r.slug, { id: r.id, label: r.label });

  let raced = false;
  for (const slug of slugs) {
    if (found.has(slug)) continue;
    try {
      const [row] = await tx
        .insert(mediaTags)
        .values({ organizationId: orgId, label: bySlug.get(slug)!, slug })
        .returning({ id: mediaTags.id, label: mediaTags.label });
      found.set(slug, row);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      raced = true;
    }
  }
  if (raced) {
    for (const r of await readExisting()) found.set(r.slug, { id: r.id, label: r.label });
  }
  return slugs.flatMap((s) => (found.has(s) ? [found.get(s)!] : []));
}

/** Création explicite d'un tag (editor et plus), retrouve l'existant sinon. */
export async function createTag(
  user: SessionUser,
  orgId: string,
  label: unknown
): Promise<TagRow> {
  if (!(await canWriteLibrary(user, orgId))) {
    throw new TagError(403, "Droits insuffisants pour créer un tag");
  }
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new TagError(400, "Libellé de tag requis");
  }
  const [tag] = await ensureTags(orgId, [label]);
  return tag;
}
