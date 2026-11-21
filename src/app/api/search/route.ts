import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { documents, spaces } from "@/lib/db/schema";
import { eq, sql, inArray, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";

/** Ligne brute retournée par db.execute() pour les recherches de documents */
interface RawDocumentRow {
  id: string;
  title: string;
  slug: string;
  space_slug?: string;
  spaceSlug?: string;
  space_name?: string;
  spaceName?: string;
  content_text?: string;
  contentText?: string;
  rank?: string;
  [key: string]: unknown;
}

/** Ligne brute pour les événements calendrier */
interface RawEventRow {
  id: string;
  title: string;
  description?: string;
  location?: string;
  start_at: string | Date;
  end_at?: string | Date;
  calendar_id?: string;
  [key: string]: unknown;
}
import { getAccessibleSpaceIds, isGlobalAdmin } from "@/lib/auth/check-access";
import { searchSemantic, isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { rerankCandidates } from "@/lib/ai/rerank";
import { fuseByRank } from "@/lib/search/rank-fusion";
import { completeWithFusionTail, rerankWindowSize } from "@/lib/search/rerank-window";
import logger from "@/lib/logger";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { isModuleActive } from "@/lib/modules/enablement";
import { searchMedia } from "@/lib/media/search";

/** Limite par défaut si absente ou invalide. */
const DEFAULT_LIMIT = 20;
/** Plafond pour éviter qu'une valeur absurde ne fasse exploser les requêtes SQL. */
const MAX_LIMIT = 100;

/**
 * Lit et borne la limite demandée par l'appelant. Une valeur non numérique,
 * négative, nulle ou déraisonnablement grande retombe sur un défaut sûr plutôt
 * que de se propager telle quelle jusqu'aux requêtes SQL.
 */
function parseLimit(raw: string | null): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(value), MAX_LIMIT);
}

/** Résultat exposé au client, avant retrait du champ interne de reclassement. */
interface SearchResultItem {
  id: string;
  title: string;
  spaceSlug: string;
  spaceName: string;
  excerpt: string;
  /**
   * Attention : après reclassement, c'est l'ORDRE du tableau rendu qui fait
   * foi. `score` reste le score de la passe d'origine (ts_rank, cosinus ou
   * valeur fixe) et n'est plus cohérent avec cet ordre. Aucun consommateur ne
   * doit retrier dessus.
   */
  score: number;
  type: string;
  /** Texte utilisé pour le reclassement. Jamais renvoyé au client. */
  rerankText: string;
}

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });

  // Cloisonnement multi-tenant : l'organisation sert de filtre à toutes les
  // passes de recherche ci-dessous (plein texte, sémantique, calendrier). Elle
  // n'est résolue que si l'utilisateur est membre du tenant du sous-domaine,
  // et `null` interrompt la requête (fail-closed) plutôt que de laisser une
  // passe s'exécuter sans filtre d'organisation.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ results: [] }, { status: 404 });
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
  const spaceSlugFilter = request.nextUrl.searchParams.get("space") || "";
  const scope = (request.nextUrl.searchParams.get("scope") || "all") as "title" | "content" | "all";
  const rerankDemande = request.nextUrl.searchParams.get("rerank") !== "0";

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Déterminer les espaces accessibles
  const spaceIds = await getAccessibleSpaceIds(user);
  const admin = isGlobalAdmin(user);

  // Si filtre par espace, résoudre le slug vers l'ID
  let filteredSpaceId: string | null = null;
  if (spaceSlugFilter) {
    const [space] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(eq(spaces.slug, spaceSlugFilter))
      .limit(1);
    if (space && spaceIds.includes(space.id)) {
      filteredSpaceId = space.id;
    }
  }

  // Clause SQL de filtrage par espace — toujours restreinte aux espaces
  // accessibles dans l'org courante (admins inclus, pas de cross-org).
  const spaceFilter = filteredSpaceId
    ? sql`d.space_id = ${filteredSpaceId}`
    : spaceIds.length > 0
    ? sql`d.space_id IN (${sql.join(spaceIds.map((id) => sql`${id}`), sql`, `)})`
    : sql`1=0`;

  // SEC-02 — Filtrage par classification de sécurité
  // Les documents « secret » ne sont visibles que par leur auteur et les admins
  const classificationFilter = admin
    ? sql`1=1`
    : sql`(d.classification != 'secret' OR d.created_by = ${user.id})`;

  const pattern = `%${q}%`;

  // ─── Chaque passe alimente sa propre liste, ordonnée selon son propre
  // critère de pertinence. La déduplication ne se fait qu'à l'intérieur
  // d'une passe : la fusion de rangs (fuseByRank) se charge de dédoublonner
  // entre passes en combinant leurs contributions.

  function buildDocResult(r: RawDocumentRow, scoreVal: number, fromContentText = true): SearchResultItem {
    const contentText = fromContentText ? r.content_text : r.contentText;
    return {
      id: r.id,
      title: r.title,
      spaceSlug: (r.space_slug ?? r.spaceSlug) || "",
      spaceName: (r.space_name ?? r.spaceName) || "",
      excerpt: buildExcerpt(contentText ?? null, q),
      score: scoreVal,
      type: "fts",
      rerankText: `${r.title}\n\n${(contentText ?? "").slice(0, 1500)}`,
    };
  }

  // ─── Stratégie hybride ─────────────────────────────────────────────────
  // Requêtes courtes (< 4 chars) ou scope restreint → ILIKE directement
  // Requêtes longues + scope all/content → FTS d'abord, ILIKE en complément

  const useIlikeOnly = q.length < 4 || scope === "title";

  const ftsList: SearchResultItem[] = [];
  if (!useIlikeOnly) {
    // FTS français sur titre + contenu
    try {
      const ftsResults = await db.execute(sql`
        SELECT
          d.id, d.title, d.slug,
          s.slug AS space_slug, s.name AS space_name,
          d.content_text, d.updated_at,
          ts_rank(d.search_vector, plainto_tsquery('french', ${q})) AS rank
        FROM documents d
        INNER JOIN spaces s ON d.space_id = s.id
        WHERE d.search_vector @@ plainto_tsquery('french', ${q})
          AND s.organization_id = ${orgId}
          AND ${spaceFilter}
          AND ${classificationFilter}
        ORDER BY rank DESC
        LIMIT ${limit}
      `);

      const seen = new Set<string>();
      for (const r of ftsResults.rows as RawDocumentRow[]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        ftsList.push(buildDocResult(r, parseFloat(r.rank ?? "0") || 1));
      }
    } catch {
      // FTS non disponible, on continue avec ILIKE
    }
  }

  // ILIKE en complément (ou seul pour les requêtes courtes)
  // Construit la clause WHERE selon le scope
  const ilikeCondition =
    scope === "title"
      ? sql`d.title ILIKE ${pattern}`
      : scope === "content"
      ? sql`d.content_text ILIKE ${pattern}`
      : sql`(d.title ILIKE ${pattern} OR d.content_text ILIKE ${pattern})`;

  const ilikeList: SearchResultItem[] = [];
  // Ne lancer ILIKE que si la passe précédente n'a pas déjà couvert la limite
  if (ftsList.length < limit) {
    try {
      const ilikeResults = await db.execute(sql`
        SELECT
          d.id, d.title, d.slug,
          s.slug AS space_slug, s.name AS space_name,
          d.content_text, d.updated_at
        FROM documents d
        INNER JOIN spaces s ON d.space_id = s.id
        WHERE ${ilikeCondition}
          AND s.organization_id = ${orgId}
          AND ${spaceFilter}
          AND ${classificationFilter}
        ORDER BY d.updated_at DESC
        LIMIT ${limit}
      `);

      const seen = new Set<string>();
      for (const r of ilikeResults.rows as RawDocumentRow[]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        ilikeList.push(buildDocResult(r, 0.8));
      }
    } catch {
      // ILIKE fallback échoué
    }
  }

  // Filet de sécurité : ILIKE sur titre uniquement si scope == "all"
  // pour couvrir les termes courts filtrés par FTS (ex: "CA")
  // Compter des identifiants DISTINCTS : les deux passes se recouvrent souvent,
  // additionner leurs longueurs surestimerait la couverture et priverait la
  // recherche de son filet de rappel sur les titres.
  const couvertureAvantTitres = new Set([
    ...ftsList.map((r) => r.id),
    ...ilikeList.map((r) => r.id),
  ]).size;

  const titleList: SearchResultItem[] = [];
  if (scope === "all" && couvertureAvantTitres < limit) {
    try {
      const titleResults = await db.execute(sql`
        SELECT
          d.id, d.title, d.slug,
          s.slug AS space_slug, s.name AS space_name,
          d.content_text, d.updated_at
        FROM documents d
        INNER JOIN spaces s ON d.space_id = s.id
        WHERE d.title ILIKE ${pattern}
          AND s.organization_id = ${orgId}
          AND ${spaceFilter}
          AND ${classificationFilter}
        ORDER BY d.updated_at DESC
        LIMIT ${limit}
      `);

      const seen = new Set<string>();
      for (const r of titleResults.rows as RawDocumentRow[]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        titleList.push(buildDocResult(r, 0.9));
      }
    } catch {
      // Fallback titre échoué
    }
  }

  // ─── Recherche sémantique si configurée ───────────────────────────────
  const semanticList: SearchResultItem[] = [];
  if (await isEmbeddingConfiguredAsync()) {
    try {
      // rerank: false, car cette route reclasse elle-même la liste fusionnée.
      // Un reclassement au niveau vectoriel serait immédiatement détruit
      // par la fusion de rangs.
      const semanticResults = await searchSemantic(q, limit, {
        spaceIds,
        viewerId: user.id,
        isGlobalAdmin: admin,
        rerank: false,
      });

      if (semanticResults.length > 0) {
        // Charger tous les documents en une seule requête (fix N+1)
        const docIds = [...new Set(semanticResults.map((sr) => sr.documentId))];
        const docs = await db
          .select({
            id: documents.id,
            title: documents.title,
            slug: documents.slug,
            spaceId: documents.spaceId,
            classification: documents.classification,
            createdBy: documents.createdBy,
            spaceSlug: spaces.slug,
            spaceName: spaces.name,
          })
          .from(documents)
          .innerJoin(spaces, eq(documents.spaceId, spaces.id))
          .where(and(inArray(documents.id, docIds), eq(spaces.organizationId, orgId)));

        const docsMap = new Map(docs.map((d) => [d.id, d]));
        const seen = new Set<string>();

        for (const sr of semanticResults) {
          const doc = docsMap.get(sr.documentId);
          if (!doc) continue;

          // Filtrer par espace accessible (org courante) + classification
          if (!spaceIds.includes(doc.spaceId)) continue;
          if (!admin && doc.classification === "secret" && doc.createdBy !== user.id) continue;
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);

          semanticList.push({
            id: doc.id,
            title: doc.title,
            spaceSlug: doc.spaceSlug,
            spaceName: doc.spaceName,
            excerpt: sr.chunkText.slice(0, 150) + "...",
            score: sr.score,
            type: "semantic",
            rerankText: sr.chunkText,
          });
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Erreur recherche sémantique");
    }
  }

  // ─── Recherche dans les événements calendrier ──────────────────────────
  const eventList: SearchResultItem[] = [];
  try {
    const eventPattern = `%${q}%`;

    // Cloisonnement : ne garder que les calendriers rattachables à
    // l'organisation courante. Trois rattachements possibles, aucune branche
    // libre (AZ-18) :
    //   - calendrier portant directement l'organisation ;
    //   - calendrier d'espace, via l'organisation de l'espace ;
    //   - calendrier PERSONNEL (ni espace ni organisation), rattaché par
    //     l'appartenance de son propriétaire à l'organisation courante.
    // La condition `space_id IS NULL` d'origine élargissait cette dernière
    // branche à tous les calendriers personnels de l'instance, tous tenants
    // confondus, pour un admin.
    const calendarOrgFilter = sql`(
      c.organization_id = ${orgId}
      OR c.space_id IN (SELECT id FROM spaces WHERE organization_id = ${orgId})
      OR (
        c.space_id IS NULL
        AND c.organization_id IS NULL
        AND c.owner_user_id IN (
          SELECT user_id FROM organization_members WHERE organization_id = ${orgId}
        )
      )
    )`;

    const calendarAccessFilter = admin
      ? sql`ce.calendar_id IN (SELECT c.id FROM calendars c WHERE ${calendarOrgFilter})`
      : spaceIds.length > 0
      ? sql`ce.calendar_id IN (
          SELECT c.id FROM calendars c
          WHERE (c.owner_user_id = ${user.id}
             OR c.space_id IN (${sql.join(spaceIds.map((id) => sql`${id}`), sql`, `)}))
            AND ${calendarOrgFilter}
        )`
      : sql`ce.calendar_id IN (
          SELECT c.id FROM calendars c
          WHERE c.owner_user_id = ${user.id}
            AND ${calendarOrgFilter}
        )`;

    const eventResults = await db.execute(sql`
      SELECT ce.id, ce.title, ce.description, ce.location, ce.start_at, ce.end_at, ce.calendar_id
      FROM calendar_events ce
      WHERE (ce.title ILIKE ${eventPattern} OR ce.description ILIKE ${eventPattern} OR ce.location ILIKE ${eventPattern})
        AND ${calendarAccessFilter}
      ORDER BY ce.start_at DESC
      LIMIT 5
    `);

    const seen = new Set<string>();
    for (const r of eventResults.rows as RawEventRow[]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const startDate = new Date(r.start_at);
      const dateStr = startDate.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      eventList.push({
        id: `event-${r.id}`,
        title: `📅 ${r.title}`,
        spaceSlug: "calendar",
        spaceName: `Événement — ${dateStr}`,
        excerpt: r.description?.slice(0, 120) || (r.location ? `Lieu : ${r.location}` : ""),
        score: 0.7,
        type: "calendar",
        rerankText: `${r.title}\n\n${r.description ?? ""} ${r.location ?? ""}`,
      });
    }
  } catch {
    // Calendar search failed (table may not exist yet)
  }

  // ─── Fusion de rangs puis reclassement ────────────────────────────────
  const fusionnes = fuseByRank<SearchResultItem>(
    [ftsList, ilikeList, titleList, semanticList, eventList],
    (r) => r.id
  );

  // La fenêtre soumise au reclassement ne descend jamais sous la limite
  // demandée, et le résultat est complété par la queue non reclassée de la
  // fusion : le reclassement réordonne, il ne doit jamais tronquer.
  const classes = rerankDemande
    ? completeWithFusionTail(
        await rerankCandidates(q, fusionnes.slice(0, rerankWindowSize(limit)), {
          getText: (r) => r.rerankText,
          topN: limit,
          surface: "search",
          userId: user.id,
          // Le reclassement envoie des extraits de documents à un point de
          // terminaison externe : ce point est celui de l'organisation de la
          // requête, jamais celui d'un tenant voisin. Cette route connaissait
          // son organisation et ne la passait pas, contrairement au chat sur
          // documents : elle retombait donc sur la portée d'instance et
          // perdait silencieusement le reclassement en multi-tenant.
          organizationId: orgId,
        }),
        fusionnes,
        limit,
        (r) => r.id
      )
    : fusionnes.slice(0, limit);

  // rerankText est un champ interne : il ne doit jamais atteindre le client.
  const results = classes.map(({ rerankText: _rerankText, ...reste }) => reste);

  // Médias : même visibilité que la liste de la médiathèque (searchMedia passe
  // par listMedia), uniquement si le module est actif pour l'organisation.
  let mediaHits: Awaited<ReturnType<typeof searchMedia>> | null = null;
  try {
    if (await isModuleActive("library", orgId)) {
      mediaHits = await searchMedia(user, orgId, q);
    }
  } catch (error) {
    logger.error({ err: error }, "Erreur recherche de médias");
  }

  return NextResponse.json(mediaHits ? { results, media: mediaHits } : { results });
}

function buildExcerpt(contentText: string | null, query: string): string {
  if (!contentText) return "";
  const idx = contentText.toLowerCase().indexOf(query.toLowerCase());
  if (idx >= 0) {
    const start = Math.max(0, idx - 50);
    const end = Math.min(contentText.length, idx + query.length + 50);
    return (
      (start > 0 ? "..." : "") +
      contentText.slice(start, end) +
      (end < contentText.length ? "..." : "")
    );
  }
  return contentText.slice(0, 120) + "...";
}
