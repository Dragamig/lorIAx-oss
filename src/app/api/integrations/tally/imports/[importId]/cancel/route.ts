import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { tallyImports } from "@/lib/db/schema";
import { notFound, resolveWebhookAutomation } from "@/lib/integrations/tally/access";
import { publicImport } from "@/lib/integrations/tally/public-import";

type P = { params: Promise<{ importId: string }> };

/** Demande l'arrêt d'un import : pris en compte avant la prochaine soumission. */
export async function POST(_req: Request, { params }: P) {
  const { importId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return notFound();
  const [row] = await db.select().from(tallyImports).where(eq(tallyImports.id, importId)).limit(1);
  if (!row) return notFound();
  // Mêmes droits que items/trace : gestionnaire, organisation, édition de l'espace.
  const g = await resolveWebhookAutomation(row.automationId);
  if ("response" in g) return g.response;
  if (row.organizationId !== g.ctx.orgId) return notFound();
  if (row.status === "pending" || row.status === "running") {
    await db
      .update(tallyImports)
      .set({ cancelRequested: true, updatedAt: new Date() })
      .where(and(eq(tallyImports.id, importId), inArray(tallyImports.status, ["pending", "running"])));
  }
  const [fresh] = await db.select().from(tallyImports).where(eq(tallyImports.id, importId)).limit(1);
  return NextResponse.json(publicImport(fresh ?? row));
}
