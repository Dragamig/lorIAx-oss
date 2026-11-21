import { NextResponse } from "next/server";
import { requireTallyManager, tallyErrorResponse, tallyRateLimited } from "@/lib/integrations/tally/access";
import { getTallyClientForOrg } from "@/lib/integrations/tally/key-store";

export async function GET() {
  const g = await requireTallyManager();
  if ("response" in g) return g.response;
  const limited = await tallyRateLimited(g.ctx.orgId, "forms");
  if (limited) return limited;
  const client = await getTallyClientForOrg(g.ctx.orgId);
  if (!client) return NextResponse.json({ error: "Tally n'est pas connecté", code: "not_connected" }, { status: 409 });
  try {
    return NextResponse.json({ forms: await client.listForms() });
  } catch (e) {
    return tallyErrorResponse(e);
  }
}
