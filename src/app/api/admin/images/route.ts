import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { ingestMedia } from "@/lib/media/ingest";
import { studioImageScope, toStudioImage } from "@/lib/media/studio-image";
import { isNull, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { validateImageUpload } from "@/lib/images/validate-upload";
import { randomUUID } from "crypto";

/**
 * Bibliothèque d'images de l'admin. Écrit dans `media` (`origin = 'studio'`), la même table
 * que le studio d'images (`src/app/api/studio/images/route.ts`).
 *
 * Trois manques constatés par la revue adversariale du lot 2 (audit du
 * 2026-08-19), tous absents ici alors que le studio les a reçus :
 *
 * 1. (INJ-03) Aucun contrôle du type de fichier : le type déclaré par le
 *    client était repris tel quel comme type stocké, et l'extension de la clé
 *    de stockage venait du nom de fichier fourni, sans jamais appeler le
 *    contrôle structurel des images vectorielles. Corrigé ici par
 *    `validateImageUpload` (`src/lib/images/validate-upload.ts`), le même
 *    module que celui utilisé par le studio.
 *
 * 2. (P0-6 / AZ-02 / AZ-12) L'organisation était résolue par
 *    `getOrgId(getOrgSlugFromHeaders(...))`, le helper que ce lot documente
 *    comme interdit en contexte authentifié parce qu'il ne contrôle aucune
 *    appartenance. Le rôle global d'administrateur exigé par cette route
 *    rendait l'escalade inter-organisation moins nette que sur le studio,
 *    mais elle restait pilotable par le sous-domaine sans contrôle
 *    d'appartenance. Corrigé ici par `requireOrgScoped`, qui s'ajoute au
 *    contrôle de rôle global, sans le remplacer.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const rows = await db
    .select()
    .from(media)
    .where(and(studioImageScope(orgId), isNull(media.spaceId)))
    .orderBy(media.createdAt);

  const images = rows.map((img) => ({ ...toStudioImage(img), url: `/api/media/${img.id}` }));
  return NextResponse.json(images);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const name = ((formData.get("name") as string) || file?.name || "image").slice(0, 255);

  if (!file) return NextResponse.json({ error: "Fichier requis" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json({ error: "Taille maximale : 10 Mo" }, { status: 400 });

  // Type réel du fichier, contrôlé par le module partagé (constat INJ-03,
  // audit du 2026-08-19) : jamais la chaîne brute du client, ni l'extension
  // du nom de fichier fourni.
  const validation = await validateImageUpload(file);
  if (!validation.ok)
    return NextResponse.json({ error: validation.error }, { status: validation.status });
  const { buffer, contentType, ext } = validation;

  const uid = randomUUID();
  const s3Key = `studio/${orgId}/org/${uid}.${ext}`;

  // Même section critique que les autres envois : verrou par organisation,
  // quota, ligne insérée avant l'envoi S3, aucune suppression d'objet.
  const result = await ingestMedia({
    user,
    orgId,
    spaceId: null,
    origin: "studio",
    storageKey: s3Key,
    displayName: name,
    file: { name: `${uid}.${ext}`, size: file.size, type: contentType },
    buffer,
  });
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json(
    { ...toStudioImage(result.media), url: `/api/media/${result.media.id}` },
    { status: 201 }
  );
}
