import { NextRequest, NextResponse } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { db } from "@/lib/db";
import { imageProviders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

/**
 * Proxy Unsplash porté par la clé d'API de l'organisation.
 *
 * L'organisation était résolue par `getOrgId(getOrgSlugFromHeaders(...))`, sans
 * contrôle d'appartenance : un membre d'un tenant quelconque consommait le
 * quota et la clé Unsplash chiffrée d'un tenant tiers en rejouant sa requête
 * sur le sous-domaine de celui-ci (audit du 2026-08-19, constat P0-6 / AZ-02).
 *
 * `requireOrgScoped` exige désormais l'appartenance à l'organisation, et répond
 * 404 pour une organisation étrangère (jamais 403).
 */

interface UnsplashPhoto {
  id: string;
  urls: { small: string; regular: string };
  alt_description?: string;
  description?: string;
  user: { name: string; links: { html: string } };
  links: { download_location: string };
}

async function getUnsplashKey(orgId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ apiKeyEnc: imageProviders.apiKeyEnc, isEnabled: imageProviders.isEnabled })
      .from(imageProviders)
      .where(and(eq(imageProviders.organizationId, orgId), eq(imageProviders.name, "unsplash")))
      .limit(1);
    if (row?.isEnabled && row.apiKeyEnc) return decrypt(row.apiKeyEnc);
  } catch { /* fallback */ }
  return process.env.UNSPLASH_ACCESS_KEY ?? null;
}

// GET /api/studio/unsplash?q=chien&page=1
// Sans q : photos populaires. Avec q : recherche.
export async function GET(req: NextRequest) {
  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const ACCESS_KEY = await getUnsplashKey(orgId);
  if (!ACCESS_KEY) return NextResponse.json({ results: [] });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const page = req.nextUrl.searchParams.get("page") ?? "1";

  const apiUrl = q
    ? `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&page=${encodeURIComponent(page)}&per_page=20`
    : `https://api.unsplash.com/photos?page=${encodeURIComponent(page)}&per_page=20&order_by=popular`;

  const res = await fetch(apiUrl, {
    headers: { Authorization: `Client-ID ${ACCESS_KEY}` },
    next: { revalidate: 300 },
  });

  if (!res.ok) return NextResponse.json({ results: [] });

  const data = await res.json();
  const raw = q ? data.results : data;

  return NextResponse.json({
    results: (raw as UnsplashPhoto[]).map((p) => ({
      id: p.id,
      thumb: p.urls.small,
      regular: p.urls.regular,
      description: p.alt_description || p.description || "",
      photographer: p.user.name,
      photographerUrl: p.user.links.html,
      downloadLocation: p.links.download_location,
    })),
    total: q ? data.total : raw.length,
  });
}
