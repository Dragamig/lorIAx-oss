import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tallyImports } from "@/lib/db/schema";
import { notFound, resolveWebhookAutomation } from "@/lib/integrations/tally/access";
import { getItemTrace } from "@/lib/integrations/tally/import-items";

type P = { params: Promise<{ importId: string; submissionId: string }> };

/** Trace rédigée d'une réponse simulée (en réel, la trace est celle du run). */
export async function GET(_req: Request, { params }: P) {
  const { importId, submissionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(importId) || !/^[A-Za-z0-9_-]{1,128}$/.test(submissionId)) return notFound();
  const [imp] = await db.select().from(tallyImports).where(eq(tallyImports.id, importId)).limit(1);
  if (!imp) return notFound();
  const r = await resolveWebhookAutomation(imp.automationId);
  if ("response" in r) return r.response;
  if (imp.organizationId !== r.ctx.orgId) return notFound();
  const item = await getItemTrace(importId, submissionId);
  if (!item) return notFound();
  return NextResponse.json({ steps: item.trace ?? [], traceTruncated: item.truncated, available: item.trace !== null });
}
