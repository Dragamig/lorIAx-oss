import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { getVisioPermissionMatrix, setVisioPermission } from "@/lib/meet/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

/**
 * Cloisonnement de la matrice de permissions visio.
 *
 * La garde de rôle `admin` en tête de handler dit « cet utilisateur administre
 * quelque chose », pas « il administre CET espace ». Le `spaceId` vient du
 * client : sans contrôle d'organisation, un admin lisait et réécrivait la
 * matrice visio d'un espace d'un autre tenant. Le correctif AZ-06 borne déjà
 * `getRequestOrgId` aux organisations dont l'admin est membre ; il reste à
 * confronter l'espace visé à cette organisation.
 *
 * Rend `true` quand l'espace est hors périmètre. Un `spaceId` nul désigne la
 * matrice par défaut, qui n'appartient à aucun espace : rien à confronter.
 * Toujours 404 côté appelant, jamais 403 : on ne révèle pas l'existence d'un
 * espace d'une autre organisation.
 */
async function isSpaceOutOfScope(
  user: { id: string; globalRole: string },
  spaceId: string | null
): Promise<boolean> {
  if (!spaceId) return false;

  const [space] = await db
    .select({ organizationId: spaces.organizationId })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!space) return true;

  // `null` = aucune organisation résolue, donc aucun accès (fail-closed).
  const orgId = await getRequestOrgId(user);
  return !orgId || space.organizationId !== orgId;
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const spaceId = req.nextUrl.searchParams.get("spaceId") || null;
  if (await isSpaceOutOfScope(user, spaceId)) {
    return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
  }

  const matrix = await getVisioPermissionMatrix(spaceId);
  return NextResponse.json(matrix);
}

const updateSchema = z.object({
  spaceId: z.string().uuid().nullable().default(null),
  action: z.enum([
    "join_immediate",
    "join_scheduled_invited",
    "join_scheduled_uninvited",
    "create_immediate",
    "create_scheduled",
    "modify_cancel",
  ]),
  role: z.enum(["viewer", "editor"]),
  allowed: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  if (await isSpaceOutOfScope(user, parsed.data.spaceId)) {
    return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
  }

  // Matrice par défaut (aucun espace visé) : elle est globale à l'instance et
  // sert de repli à `checkVisioPermission` pour TOUTES les organisations. Il
  // n'y a donc aucun espace à confronter, et son écriture par un admin d'une
  // organisation porterait sur tous les tenants à la fois. Même raisonnement
  // que les labels globaux et les sauvegardes : la portée instance se règle
  // par le rôle (audit AZ-06).
  if (!parsed.data.spaceId && !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  await setVisioPermission(
    parsed.data.spaceId,
    parsed.data.action,
    parsed.data.role,
    parsed.data.allowed
  );

  return NextResponse.json({ success: true });
}
