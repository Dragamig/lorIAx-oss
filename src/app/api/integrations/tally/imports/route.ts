import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { tallyImports } from "@/lib/db/schema";
import { resolveWebhookAutomation, tallyErrorResponse, tallyRateLimited } from "@/lib/integrations/tally/access";
import { getTallyClientForOrg } from "@/lib/integrations/tally/key-store";
import { ActiveImportError, findActiveImport, startImport } from "@/lib/integrations/tally/import-runner";
import { publicImport } from "@/lib/integrations/tally/public-import";
import { getSetting } from "@/lib/settings/system-settings";

const bodySchema = z.object({
  automationId: z.string().uuid(),
  formId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  mode: z.enum(["simulate", "real"]),
  since: z.string().datetime({ offset: true }).optional(),
});

/** Lance un import de soumissions Tally dans un automatisme webhook entrant. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  const { automationId, formId, mode, since } = parsed.data;

  const r = await resolveWebhookAutomation(automationId);
  if ("response" in r) return r.response;

  if (mode === "real") {
    const cfg = await getSetting<{ enabled?: boolean }>("automations");
    if (cfg && cfg.enabled === false) {
      return NextResponse.json({ error: "Les automatisations sont désactivées globalement par l'administrateur" }, { status: 403 });
    }
    if (!r.automation.enabled) {
      return NextResponse.json({ error: "Activez l'automatisme avant un import réel" }, { status: 409 });
    }
  }
  const limited = await tallyRateLimited(r.ctx.orgId, "imports");
  if (limited) return limited;
  const client = await getTallyClientForOrg(r.ctx.orgId);
  if (!client) return NextResponse.json({ error: "Tally n'est pas connecté", code: "not_connected" }, { status: 409 });
  try {
    await client.getForm(formId);
  } catch (e) {
    return tallyErrorResponse(e);
  }
  if (await findActiveImport(automationId)) {
    return NextResponse.json({ error: "Un import est déjà en cours pour cet automatisme" }, { status: 409 });
  }
  let importId: string;
  try {
    importId = await startImport({
      organizationId: r.ctx.orgId,
      automation: r.automation,
      formId,
      mode,
      since: since ? new Date(since) : null,
      actor: { id: r.ctx.user.id, email: r.ctx.user.email ?? undefined, name: r.ctx.user.name ?? undefined },
    });
  } catch (e) {
    if (e instanceof ActiveImportError) {
      return NextResponse.json({ error: "Un import est déjà en cours pour cet automatisme" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ importId }, { status: 202 });
}

/** Derniers imports d'un automatisme. */
export async function GET(request: Request) {
  const automationId = new URL(request.url).searchParams.get("automationId") ?? "";
  const r = await resolveWebhookAutomation(automationId);
  if ("response" in r) return r.response;
  const rows = await db
    .select()
    .from(tallyImports)
    .where(eq(tallyImports.automationId, automationId))
    .orderBy(desc(tallyImports.createdAt))
    .limit(10);
  return NextResponse.json({ imports: rows.map(publicImport) });
}
