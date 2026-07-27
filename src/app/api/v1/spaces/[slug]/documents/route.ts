import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq, and, gt, asc, isNull } from "drizzle-orm";
import { authenticateApiRequest, requireScope } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import {
  checkSpaceViewAccess,
  buildDocumentVisibilityFilter,
} from "@/lib/auth/check-access";

/**
 * GET /api/v1/spaces/:slug/documents — List documents in a space.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const scopeErr = requireScope(auth.user, "documents:read");
  if (scopeErr) return scopeErr;

  // Find space
  const [space] = await db
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.slug, slug))
    .limit(1);

  if (!space) {
    return apiError("Espace introuvable", 404);
  }

  // Le scope `documents:read` autorise l'appel, il ne dit rien de l'espace vise :
  // le controle de permission s'ajoute au controle de scope, il ne le remplace pas.
  //
  // Mode `publicApi` : la route detail ne doit pas etre plus permissive que l'index
  // GET /api/v1/spaces, qui ne retourne que les espaces possedes ou portant une
  // permission directe et exclut les espaces `secret`. Rendre listables par slug des
  // espaces que l'API publique masque dans son propre index elargirait une surface
  // exposee, ce qu'un lot de securite ne doit pas faire.
  const canView = await checkSpaceViewAccess(auth.user, space.id, "publicApi");
  if (!canView) {
    return apiError("Accès refusé", 403);
  }

  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const parentId = searchParams.get("parentId") || null;

  const conditions = [eq(documents.spaceId, space.id)];

  if (parentId) {
    conditions.push(eq(documents.parentId, parentId));
  } else {
    conditions.push(isNull(documents.parentId));
  }

  if (cursor) {
    conditions.push(gt(documents.id, cursor));
  }

  const results = await db
    .select({
      id: documents.id,
      title: documents.title,
      slug: documents.slug,
      icon: documents.icon,
      isFolder: documents.isFolder,
      visibility: documents.visibility,
      parentId: documents.parentId,
      position: documents.position,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      classification: documents.classification,
      createdBy: documents.createdBy,
    })
    .from(documents)
    .where(and(...conditions))
    .orderBy(asc(documents.position), asc(documents.id))
    .limit(limit + 1);

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  // Le curseur est calcule AVANT le filtrage par classification, de sorte que le
  // filtrage ne fasse pas sauter de page : il ne fait que raccourcir celle servie.
  //
  // Il ne rend pas la pagination exacte pour autant, et ne la degrade pas non plus :
  // la route trie par `asc(position), asc(id)` mais pagine par `gt(documents.id,
  // cursor)`. Curseur et ordre portent sur des cles differentes, donc des documents
  // sont sautes ou repetes des que deux d'entre eux ont `position` et `id` en ordre
  // inverse. Defaut preexistant, hors perimetre de ce lot de securite.
  const nextCursor = hasMore ? page[page.length - 1]?.id : null;

  const isVisible = await buildDocumentVisibilityFilter(auth.user, space.id);
  const data = page
    .filter(isVisible)
    .map(({ classification: _c, createdBy: _u, ...doc }) => doc);

  return apiSuccess(data, { cursor: nextCursor, hasMore });
}
