/**
 * Liste des modèles de présentation de l'organisation (lot 3bis).
 *
 * Lecture ouverte à tout membre ; le premier appel d'une organisation déclenche
 * le semis des modèles LorIAx. Les modèles masqués ne sont rendus qu'à un
 * administrateur.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTemplateReader } from "@/lib/presentations/template-access";
import { ensureSeededTemplates, listTemplates } from "@/lib/presentations/templates";

export async function GET(req: NextRequest) {
  const ctx = await requireTemplateReader(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    await ensureSeededTemplates(ctx.orgId, ctx.user.id);
    const templates = await listTemplates(ctx.orgId, {
      includeHidden: ctx.canManage,
      seededOnly: !ctx.isMember,
    });
    return NextResponse.json({ templates });
  } catch (err) {
    console.error("[presentations/templates GET] Erreur :", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
