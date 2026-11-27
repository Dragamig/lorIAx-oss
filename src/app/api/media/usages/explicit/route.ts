import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { spaces, designSnapshots, whiteboardSnapshots } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkSpaceReadAccess } from "@/lib/auth/check-access";
import { checkCanvasEditAccess, getRequestedDocumentId } from "@/lib/auth/canvas-access";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { UUID_RE, readJsonObject } from "@/lib/media/folders-http";
import { setExplicitUsages } from "@/lib/media/explicit-usages";

const bodySchema = z
  .object({
    targetType: z.enum(["design", "whiteboard"]),
    targetId: z.string().regex(UUID_RE),
    context: z.string().max(120).nullable().optional(),
    documentId: z.string().regex(UUID_RE).nullable().optional(),
    spaceId: z.string().regex(UUID_RE).nullable(),
    mediaIds: z.array(z.string().regex(UUID_RE)).max(500),
  })
  .strict();

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });

  const parsed = bodySchema.safeParse(await readJsonObject(req));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
  const body = parsed.data;

  // Poser des usages sur une cible exige le droit d'ÉCRITURE sur cette cible (document porteur).
  const [snap] =
    body.targetType === "design"
      ? await db
          .select({ documentId: designSnapshots.documentId })
          .from(designSnapshots)
          .where(eq(designSnapshots.designId, body.targetId))
          .limit(1)
      : await db
          .select({ documentId: whiteboardSnapshots.documentId })
          .from(whiteboardSnapshots)
          .where(eq(whiteboardSnapshots.canvasId, body.targetId))
          .limit(1);
  const access = await checkCanvasEditAccess(user, body.targetId, {
    rowExists: !!snap,
    storedDocumentId: snap?.documentId ?? null,
    requestedDocumentId: body.documentId ?? getRequestedDocumentId(req),
    // Cette route n'insère aucune ligne : sans snapshot, le document doit mentionner la cible.
    requireMention: true,
  });
  if (!access.ok) return NextResponse.json({ error: "Accès refusé" }, { status: access.status });

  if (body.spaceId) {
    const [space] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, body.spaceId), eq(spaces.organizationId, orgId)))
      .limit(1);
    if (!space || !(await checkSpaceReadAccess(user, space.id, { orgId }))) {
      return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
    }
  }

  const result = await setExplicitUsages({
    user,
    orgId,
    targetType: body.targetType,
    targetId: body.targetId,
    context: body.context ?? null,
    spaceId: body.spaceId,
    mediaIds: body.mediaIds,
  });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
