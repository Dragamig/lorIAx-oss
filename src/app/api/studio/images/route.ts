import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { ingestMedia } from "@/lib/media/ingest";
import { findDuplicates } from "@/lib/media/duplicates";
import { sha256Hex } from "@/lib/media/image-processing";
import { studioImageScope, toStudioImage } from "@/lib/media/studio-image";
import { eq, or, isNull, and } from "drizzle-orm";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { randomUUID } from "crypto";
import { validateImageUpload } from "@/lib/images/validate-upload";

/**
 * Bibliothèque d'images du studio.
 *
 * L'organisation était résolue par `getOrgId(getOrgSlugFromHeaders(...))`, qui
 * traduit le slug du sous-domaine en identifiant sans contrôler que
 * l'utilisateur appartient à cette organisation. Le cookie de session étant
 * valide sur tous les sous-domaines, un membre du seul tenant `acme` listait et
 * alimentait l'inventaire d'images d'un tenant tiers en rejouant ses requêtes
 * sur son sous-domaine (audit du 2026-08-19, constat P0-6 / AZ-02 / AZ-12).
 *
 * De plus, le `spaceId` du formulaire servait de préfixe de clé S3 et de colonne
 * sans que le droit d'écriture sur l'espace soit vérifié (constat INJ-23).
 *
 * `requireOrgScoped` couvre les deux gestes : appartenance à l'organisation, et
 * seuil de permission sur l'espace visé. Une organisation ou un espace étranger
 * donne 404, jamais 403, pour ne rien révéler de leur existence.
 *
 * Le type MIME déclaré par le client ne fait plus foi non plus (constat INJ-03,
 * audit du 2026-08-19). Ce contrôle vit désormais dans un module partagé,
 * `src/lib/images/validate-upload.ts`, utilisé aussi par la bibliothèque
 * d'images de l'admin (`src/app/api/admin/images/**`, qui écrit dans la même
 * table). Le SVG reste accepté parce que le logo de marque en SVG est un
 * usage réel du panneau « Marque » et du studio design ; sa neutralisation
 * est posée à la restitution, dans `src/lib/media/serve.ts`.
 */

// GET /api/studio/images?spaceId=xxx
export async function GET(req: NextRequest) {
  const url = req.nextUrl ?? new URL(req.url);
  const spaceId = url.searchParams.get("spaceId");

  let orgId: string;
  try {
    // Lecture d'un espace : niveau `viewer`, c'est le seuil d'une consultation.
    const ctx = spaceId
      ? await requireOrgScoped({
          resource: { type: "space", id: spaceId },
          minPermission: "viewer",
        })
      : await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const rows = await db
    .select()
    .from(media)
    .where(
      and(
        studioImageScope(orgId),
        spaceId
          ? or(eq(media.spaceId, spaceId), isNull(media.spaceId))
          : isNull(media.spaceId)
      )
    )
    .orderBy(media.createdAt);

  const images = rows.map((img) => ({
    ...toStudioImage(img),
    url: `/api/media/${img.id}`,
  }));

  return NextResponse.json(images);
}

// POST /api/studio/images — multipart/form-data: file, name?, spaceId?
export async function POST(req: NextRequest) {
  let ctx: Awaited<ReturnType<typeof requireOrgScoped>>;
  let orgId: string;
  try {
    ctx = await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const name = ((formData.get("name") as string) || file?.name || "image").slice(0, 255);
  const spaceId = (formData.get("spaceId") as string) || null;

  // Écriture dans un espace : seuil `editor`, un `viewer` ne dépose rien.
  // Sans `spaceId`, l'image reste au niveau de l'organisation, déjà contrôlée.
  if (spaceId) {
    try {
      await requireOrgScoped({
        resource: { type: "space", id: spaceId },
        minPermission: "editor",
      });
    } catch (e) {
      if (e instanceof OrgScopeError) return e.response;
      throw e;
    }
  }

  if (!file) return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json({ error: "Taille maximale : 10 Mo" }, { status: 400 });

  // Type réel du fichier, contrôlé par le module partagé (constat INJ-03,
  // audit du 2026-08-19) : jamais la chaîne brute du client.
  const validation = await validateImageUpload(file);
  if (!validation.ok)
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  const { buffer, contentType: declaredType, ext } = validation;

  // Export de design : un contenu identique déjà présent n'est pas recréé (SHA-256).
  const isExport = formData.get("kind") === "design-export";
  if (isExport) {
    const sum = sha256Hex(buffer);
    const hit = (await findDuplicates(ctx.user, orgId, [sum]))[sum];
    if (hit) {
      return NextResponse.json({ id: hit.id, url: `/api/media/${hit.id}`, duplicate: true }, { status: 200 });
    }
  }

  const uid = randomUUID();
  // Les miniatures de bloc design ont un chemin de clé propre (`design-thumbnails`),
  // critère objectif du ramassage (`stale-thumbnails.ts`) : le nom, lui, se renomme.
  const s3Key =
    formData.get("kind") === "design-thumbnail"
      ? `studio/${orgId}/design-thumbnails/${uid}.${ext}`
      : spaceId
        ? `studio/${orgId}/spaces/${spaceId}/${uid}.${ext}`
        : `studio/${orgId}/org/${uid}.${ext}`;

  // Même section critique que les autres envois : verrou par organisation,
  // quota, ligne insérée avant l'envoi S3, aucune suppression d'objet.
  const result = await ingestMedia({
    user: ctx.user,
    orgId,
    spaceId,
    origin: "studio",
    storageKey: s3Key,
    displayName: name,
    file: { name: `${uid}.${ext}`, size: file.size, type: declaredType },
    buffer,
  });
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json(
    {
      ...toStudioImage(result.media),
      url: `/api/media/${result.media.id}`,
      ...(isExport ? { duplicate: false } : {}),
    },
    { status: 201 }
  );
}
