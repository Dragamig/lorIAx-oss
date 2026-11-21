/**
 * Réinitialisation d'un modèle d'origine LorIAx (admin) : contenu remplacé par
 * la version du dépôt, modèle démasqué, version incrémentée.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { presentations } from "@/lib/db/schema-presentations";
import { assertTemplateInOrg, requireTemplateAdmin } from "@/lib/presentations/template-access";
import { resetTemplate } from "@/lib/presentations/templates";

const bodySchema = z.object({ expectedVersion: z.number().int().positive().optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTemplateAdmin(req);
  if (ctx instanceof NextResponse) return ctx;

  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const [row] = await db
    .select()
    .from(presentations)
    .where(and(eq(presentations.id, id), eq(presentations.isTemplate, true)))
    .limit(1);
  if (!row) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const outside = assertTemplateInOrg(row, ctx.orgId);
  if (outside) return outside;

  let expectedVersion: number | undefined;
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });
    expectedVersion = parsed.data.expectedVersion;
  } catch {
    // Corps absent : pas de contrôle de version côté client.
  }
  if (expectedVersion !== undefined && expectedVersion !== row.version) {
    return NextResponse.json(
      { error: "Conflit de version", currentVersion: row.version },
      { status: 409 }
    );
  }

  const result = await resetTemplate(row, ctx.orgId);
  switch (result.status) {
    case "ok":
      return NextResponse.json({ template: result.presentation });
    case "not-found":
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    case "not-resettable":
      return NextResponse.json(
        { error: "Seuls les modèles LorIAx peuvent être réinitialisés" },
        { status: 422 }
      );
    case "conflict":
      return NextResponse.json(
        { error: "Conflit de version", currentVersion: result.currentVersion },
        { status: 409 }
      );
    default:
      return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
