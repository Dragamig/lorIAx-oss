import { NextRequest, NextResponse } from "next/server";
import { guardMediaRead } from "@/lib/media/route-guard";
import { getMediaTextState } from "@/lib/media/ai/text-state";
import { parseTextQuery } from "@/lib/media/ai/text-http";

type Ctx = { params: Promise<{ id: string }> };

/** GET : état d'indexation et texte extrait (page bornée). Lecture du média requise, corbeille refusée. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const g = await guardMediaRead(id);
  if (!g.ok) return g.res;
  if (g.row.deletedAt) return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  const q = parseTextQuery(req.url);
  if (!q.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  const state = await getMediaTextState(g.row, q.data);
  return NextResponse.json(state, {
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
