import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageProviders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { decrypt } from "@/lib/crypto";
import { fetchAllowlistedHost } from "@/lib/security/outbound-fetch";

/**
 * Notification de téléchargement exigée par les conditions d'Unsplash : l'URL
 * `download_location` d'une photo doit être appelée quand l'image est utilisée.
 *
 * L'URL vient du client, et l'appel porte la clé Unsplash de l'organisation en
 * clair dans un en-tête `Authorization`. Elle est donc contrainte à l'API
 * d'Unsplash : sans cette liste blanche, l'endpoint émettait le secret vers
 * l'hôte de l'appelant et offrait un SSRF aveugle vers le réseau interne
 * (audit du 2026-08-19, constat P0-1 / INJ-02 / AZ-03).
 */
const UNSPLASH_API_HOSTS = ["api.unsplash.com"] as const;

export async function GET(req: NextRequest) {
  // L'organisation est résolue par le helper qui contrôle l'appartenance :
  // `getOrgId` traduisait un slug sans aucun contrôle, donc un membre d'un
  // autre tenant consommait la clé Unsplash de l'organisation visée
  // (audit du 2026-08-19, constat P0-6 / AZ-12).
  let orgId: string;
  try {
    ({ orgId } = await requireOrgScoped({}, req));
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const downloadUrl = req.nextUrl.searchParams.get("url");
  if (!downloadUrl) return new NextResponse(null, { status: 204 });

  try {
    const [row] = await db
      .select({ apiKeyEnc: imageProviders.apiKeyEnc })
      .from(imageProviders)
      .where(and(eq(imageProviders.organizationId, orgId), eq(imageProviders.name, "unsplash")))
      .limit(1);
    const key = row?.apiKeyEnc ? decrypt(row.apiKeyEnc) : (process.env.UNSPLASH_ACCESS_KEY ?? "");
    if (key) {
      // La clé ne part que si l'hôte est bien celui d'Unsplash : le contrôle
      // est fait par `fetchAllowlistedHost` avant que la requête ne soit émise.
      await fetchAllowlistedHost(downloadUrl, {
        hosts: UNSPLASH_API_HOSTS,
        init: { headers: { Authorization: `Client-ID ${key}` } },
      });
    }
  } catch {
    /* best-effort : ni l'échec réseau ni le refus de l'hôte ne remontent au client */
  }

  return new NextResponse(null, { status: 204 });
}
