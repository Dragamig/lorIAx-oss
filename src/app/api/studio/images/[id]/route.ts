import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { studioImageScope, toStudioImage } from "@/lib/media/studio-image";
import { s3Client, BUCKET } from "@/lib/storage/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { eq, and } from "drizzle-orm";
import { getSpacePermission } from "@/lib/auth/check-access";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import type { PermissionLevel } from "@/types";

/**
 * Image unitaire du studio (proxy S3, renommage, suppression).
 *
 * L'organisation était résolue par `getOrgId(getOrgSlugFromHeaders(...))`, sans
 * aucun contrôle d'appartenance : un membre d'un tenant quelconque téléchargeait
 * les images d'un tenant tiers en rejouant ses requêtes sur le sous-domaine de
 * la victime, et le DELETE détruisait la ligne en base ET l'objet S3
 * (audit du 2026-08-19, constat P0-6 / AZ-02 / AZ-12).
 *
 * `requireOrgScoped` contrôle désormais l'appartenance. L'image est ensuite
 * filtrée sur cette organisation, ce qui garantit que son espace éventuel
 * appartient au même tenant : le seul contrôle restant est le niveau de
 * permission sur cet espace. Les images sans espace sont au niveau de
 * l'organisation et ne portent donc pas de contrôle d'espace.
 *
 * La restitution est en outre neutralisée (constat INJ-03, audit du
 * 2026-08-19) : le contenu était resservi avec le `Content-Type` stocké, sans
 * `nosniff`, sans politique de sécurité de contenu et sans `Content-Disposition`
 * sur une route `/api/*` qui n'en recevait aucune. Un SVG porteur d'un script
 * s'exécutait donc sur l'origine de l'application, dans la session de la
 * victime.
 */

/** Types resservis tels quels. Tout le reste retombe en flux binaire opaque. */
const SERVABLE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

/**
 * Types rendus en ligne. Le SVG en est volontairement exclu : c'est le seul
 * format de la liste que le navigateur exécute quand il est ouvert en
 * navigation de premier niveau. Les formats matriciels restent `inline`, car
 * le studio design et le panneau « Marque » les affichent en balise image.
 */
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Politique verrouillée posée sur la réponse. Inerte pour une image chargée en
 * sous-ressource (`<img>` n'applique pas la CSP de la ressource), active dès que
 * le document est ouvert en navigation : plus aucun script, plus aucune requête
 * sortante, pas d'encadrement.
 */
const ASSET_CSP =
  "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

/** Nom de fichier sûr pour l'en-tête `Content-Disposition` (jeton ASCII). */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
  return cleaned || "image";
}

const PERMISSION_RANK: Record<PermissionLevel, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
};

/**
 * Vérifie le seuil de permission sur l'espace porteur de l'image.
 * `spaceId` nul = image au niveau de l'organisation, déjà autorisée.
 */
async function hasSpaceAccess(
  userId: string,
  spaceId: string | null,
  required: PermissionLevel
): Promise<boolean> {
  if (!spaceId) return true;
  const permission = await getSpacePermission(userId, spaceId);
  if (!permission) return false;
  return PERMISSION_RANK[permission] >= PERMISSION_RANK[required];
}

function notFound(): NextResponse {
  return NextResponse.json({ error: "Image introuvable" }, { status: 404 });
}

// GET /api/studio/images/[id] — proxy de l'image depuis S3
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    userId = ctx.user.id;
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const { id } = await params;

  const [row] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, id), studioImageScope(orgId)))
    .limit(1);

  if (!row) return notFound();
  // Lecture : seuil `viewer`. Un non-membre de l'espace ne voit pas l'image.
  if (!(await hasSpaceAccess(userId, row.spaceId, "viewer"))) return notFound();

  const s3Obj = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: row.storageKey }));
  const body = s3Obj.Body;
  if (!body) return NextResponse.json({ error: "Contenu vide" }, { status: 500 });

  const chunks: Uint8Array[] = [];
  // @ts-expect-error — Body est un stream Node.js
  for await (const chunk of body) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);

  // Un type non prévu (ligne héritée d'avant le contrôle à l'upload) est
  // resservi en flux binaire opaque, jamais dans le type stocké.
  const storedType = (row.mimeType || "").split(";")[0]!.trim().toLowerCase();
  const contentType = SERVABLE_TYPES.has(storedType) ? storedType : "application/octet-stream";
  const disposition = INLINE_TYPES.has(contentType) ? "inline" : "attachment";

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": ASSET_CSP,
      "Content-Disposition": `${disposition}; filename="${safeFilename(row.filename || "image")}"`,
    },
  });
}

// PATCH /api/studio/images/[id] — { name: string }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    userId = ctx.user.id;
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const { id } = await params;
  const body = await req.json();
  const name = body?.name?.trim();
  if (!name) return NextResponse.json({ error: "Nom requis" }, { status: 400 });

  // Lire avant d'écrire : la permission d'espace se contrôle sur la ligne
  // existante, et un refus ne doit laisser aucune trace en base.
  const [existing] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, id), studioImageScope(orgId)))
    .limit(1);

  if (!existing) return notFound();
  // Renommage : seuil `editor`, c'est une écriture.
  if (!(await hasSpaceAccess(userId, existing.spaceId, "editor"))) return notFound();

  const [row] = await db
    .update(media)
    .set({ filename: name.slice(0, 255), updatedAt: new Date() })
    .where(and(eq(media.id, id), studioImageScope(orgId)))
    .returning();

  if (!row) return notFound();
  return NextResponse.json(toStudioImage(row));
}

// DELETE /api/studio/images/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let userId: string;
  let orgId: string;
  try {
    const ctx = await requireOrgScoped();
    userId = ctx.user.id;
    orgId = ctx.orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  const { id } = await params;

  // Lire avant de supprimer : rien ne doit être mis en corbeille
  // quand la permission d'espace manque.
  const [existing] = await db
    .select()
    .from(media)
    .where(and(eq(media.id, id), studioImageScope(orgId)))
    .limit(1);

  if (!existing) return notFound();
  // Suppression : seuil `editor`, même seuil que le renommage.
  if (!(await hasSpaceAccess(userId, existing.spaceId, "editor"))) return notFound();

  const [row] = await db
    .update(media)
    .set({ deletedAt: new Date(), deletedBy: userId })
    .where(and(eq(media.id, id), studioImageScope(orgId)))
    .returning();

  if (!row) return notFound();
  // Suppression douce : l'objet S3 n'est jamais supprimé ici (purge de corbeille
  // en 1b).
  return new NextResponse(null, { status: 204 });
}
