import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { labels } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { z } from "zod";

// GET /api/labels — retourne tous les labels globaux
export async function GET(_request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const result = await db
    .select()
    .from(labels)
    .where(eq(labels.isGlobal, true))
    .orderBy(labels.name);

  return NextResponse.json(result);
}

const createLabelSchema = z.object({
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Couleur invalide (format attendu : #RRGGBB)"),
  isGlobal: z.literal(true),
});

// POST /api/labels — crée un label global (super_admin uniquement)
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  // Cloisonnement multi-tenant (audit AZ-06) : les labels globaux sont une
  // taxonomie partagée par toute l'instance, sans organisation. Leur création
  // rejoint donc leur modification et leur suppression (`labels/[id]`), déjà
  // réservées au `super_admin` : un admin d'organisation ne pollue plus
  // l'espace de noms de tous les tenants.
  if (!hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = createLabelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [label] = await db
    .insert(labels)
    .values({
      name: parsed.data.name,
      color: parsed.data.color,
      isGlobal: true,
      spaceId: null,
      createdBy: user.id,
    })
    .returning();

  if (!label) return NextResponse.json({ error: 'Failed to create label' }, { status: 500 });

  return NextResponse.json(label, { status: 201 });
}
