import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageProviders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { decrypt } from "@/lib/crypto";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import {
  searchPexels,
  searchPixabay,
  searchShutterstock,
  searchGetty,
} from "@/lib/images/adapters";
import { searchUnsplash } from "@/lib/images/unsplash";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  // Cloisonnement multi-tenant : sans appartenance à l'organisation du
  // sous-domaine, la clé chiffrée du tenant visé n'est jamais déchiffrée.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const { id } = await params;

  const [row] = await db
    .select()
    .from(imageProviders)
    .where(and(eq(imageProviders.id, id), eq(imageProviders.organizationId, orgId)))
    .limit(1);

  if (!row)
    return NextResponse.json({ ok: false, error: "Fournisseur introuvable" }, { status: 404 });

  const apiKey = row.apiKeyEnc
    ? decrypt(row.apiKeyEnc)
    : row.providerType === "unsplash"
      ? (process.env.UNSPLASH_ACCESS_KEY ?? "")
      : "";

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: "Aucune clé API configurée",
    }, { status: 400 });
  }

  try {
    let total = 0;
    switch (row.providerType) {
      case "unsplash":
        total = (await searchUnsplash("test", 1, apiKey)).results.length;
        break;
      case "pexels":
        total = (await searchPexels("test", 1, apiKey)).results.length;
        break;
      case "pixabay":
        total = (await searchPixabay("test", 1, apiKey)).results.length;
        break;
      case "shutterstock":
        total = (await searchShutterstock("test", 1, apiKey)).results.length;
        break;
      case "getty":
        total = (await searchGetty("test", 1, apiKey)).results.length;
        break;
      default:
        return NextResponse.json({
          ok: false,
          error: "Test indisponible pour ce type de fournisseur",
        });
    }
    return NextResponse.json({ ok: true, sample: total });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    return NextResponse.json({ ok: false, error: message });
  }
}
