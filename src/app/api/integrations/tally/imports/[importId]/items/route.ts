import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tallyImports } from "@/lib/db/schema";
import { notFound, resolveWebhookAutomation } from "@/lib/integrations/tally/access";
import { listImportItems } from "@/lib/integrations/tally/import-items";

type P = { params: Promise<{ importId: string }> };

/** Détail par réponse d'un import (simulé ou réel), filtrable et paginé par 200. */
export async function GET(req: Request, { params }: P) {
  const { importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return notFound();
  const [imp] = await db.select().from(tallyImports).where(eq(tallyImports.id, importId)).limit(1);
  if (!imp) return notFound();
  // Mêmes droits que les routes d'import : gestionnaire, organisation, édition de l'espace.
  const r = await resolveWebhookAutomation(imp.automationId);
  if ("response" in r) return r.response;
  if (imp.organizationId !== r.ctx.orgId) return notFound();
  const sp = new URL(req.url).searchParams;
  const page = await listImportItems(importId, {
    outcome: sp.get("outcome"),
    offset: Number.parseInt(sp.get("offset") ?? "0", 10) || 0,
    limit: Number.parseInt(sp.get("limit") ?? "200", 10) || 200,
  });
  return NextResponse.json(page);
}
