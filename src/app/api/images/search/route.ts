import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageProviders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { decrypt } from "@/lib/crypto";
import {
  searchPexels,
  searchPixabay,
  searchShutterstock,
  searchGetty,
} from "@/lib/images/adapters";
import { searchUnsplash } from "@/lib/images/unsplash";

/**
 * Recherche dans les banques d'images configurées par l'organisation.
 *
 * L'organisation était résolue par `getOrgId(getOrgSlugFromHeaders(...))`, qui
 * ne contrôle aucune appartenance : un membre d'un tenant quelconque consommait
 * les clés d'API tierces chiffrées d'un tenant victime en rejouant sa requête
 * sur le sous-domaine de celui-ci (audit du 2026-08-19, constat P0-6 / AZ-02).
 *
 * `requireOrgScoped` exige désormais une ligne `organization_members` pour une
 * organisation isolée, et répond 404 sinon.
 */

export async function GET(req: NextRequest) {
  let orgId: string;
  try {
    // Pas de ressource d'espace ici : la clé d'API est au niveau de
    // l'organisation, seule l'appartenance a un sens comme seuil.
    const ctx = await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider") ?? "";
  const query = searchParams.get("q") ?? "";
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);

  if (!provider) {
    return NextResponse.json({ error: "provider requis" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(imageProviders)
    .where(
      and(
        eq(imageProviders.organizationId, orgId),
        eq(imageProviders.name, provider),
        eq(imageProviders.isEnabled, true)
      )
    )
    .limit(1);

  if (!row) {
    return NextResponse.json(
      { error: "Fournisseur introuvable ou désactivé" },
      { status: 404 }
    );
  }

  const apiKey = row.apiKeyEnc
    ? decrypt(row.apiKeyEnc)
    : row.providerType === "unsplash"
      ? (process.env.UNSPLASH_ACCESS_KEY ?? "")
      : "";

  if (!apiKey && row.providerType !== "unsplash") {
    return NextResponse.json(
      { error: "Clé API manquante pour ce fournisseur" },
      { status: 400 }
    );
  }

  try {
    switch (row.providerType) {
      case "unsplash":
        return NextResponse.json(await searchUnsplash(query, page, apiKey));
      case "pexels":
        return NextResponse.json(await searchPexels(query, page, apiKey));
      case "pixabay":
        return NextResponse.json(await searchPixabay(query, page, apiKey));
      case "shutterstock":
        return NextResponse.json(await searchShutterstock(query, page, apiKey));
      case "getty":
        return NextResponse.json(await searchGetty(query, page, apiKey));
      default:
        return NextResponse.json(
          { error: "Fournisseur non pris en charge pour la recherche" },
          { status: 400 }
        );
    }
  } catch {
    return NextResponse.json(
      { error: "Erreur du service d'images" },
      { status: 502 }
    );
  }
}
