import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWebhookAutomation, requireTallyManager, tallyErrorResponse, tallyRateLimited } from "@/lib/integrations/tally/access";
import { getTallyClientForOrg } from "@/lib/integrations/tally/key-store";
import { countSubmissions } from "@/lib/integrations/tally/import-runner";

const querySchema = z.object({
  formId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  automationId: z.string().uuid().optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

/** Compte les soumissions d'un formulaire, déjà importées vs à importer. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    formId: url.searchParams.get("formId") ?? undefined,
    automationId: url.searchParams.get("automationId") ?? undefined,
    since: url.searchParams.get("since") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  const { formId, automationId, since } = parsed.data;

  let orgId: string;
  if (automationId) {
    const r = await resolveWebhookAutomation(automationId);
    if ("response" in r) return r.response;
    orgId = r.ctx.orgId;
  } else {
    const g = await requireTallyManager();
    if ("response" in g) return g.response;
    orgId = g.ctx.orgId;
  }
  const limited = await tallyRateLimited(orgId, "count");
  if (limited) return limited;
  const client = await getTallyClientForOrg(orgId);
  if (!client) return NextResponse.json({ error: "Tally n'est pas connecté", code: "not_connected" }, { status: 409 });
  try {
    const counts = await countSubmissions(client, formId, {
      since: since ? new Date(since) : null,
      automationId: automationId ?? null,
    });
    return NextResponse.json(counts);
  } catch (e) {
    return tallyErrorResponse(e);
  }
}
