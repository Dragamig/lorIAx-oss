import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tallyImports } from "@/lib/db/schema";
import { notFound, resolveWebhookAutomation } from "@/lib/integrations/tally/access";
import { publicImport } from "@/lib/integrations/tally/public-import";

type P = { params: Promise<{ importId: string }> };

/** Progression d'un import (sondage). */
export async function GET(_req: Request, { params }: P) {
  const { importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return notFound();
  const [row] = await db.select().from(tallyImports).where(eq(tallyImports.id, importId)).limit(1);
  if (!row) return notFound();
  // Mêmes droits que items/trace : gestionnaire, organisation, édition de l'espace.
  const g = await resolveWebhookAutomation(row.automationId);
  if ("response" in g) return g.response;
  if (row.organizationId !== g.ctx.orgId) return notFound();
  return NextResponse.json(publicImport(row));
}
