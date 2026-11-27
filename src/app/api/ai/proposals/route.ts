import { NextResponse, type NextRequest } from "next/server";
import { accessErrorResponse, isUuid, sessionScope } from "@/lib/ai/proposals/route-utils";
import { getOwnProposal, listOpenProposals, listPendingProposals } from "@/lib/ai/proposals/store";
import { buildProposalViews } from "@/lib/ai/proposals/view";
import type { AiProposalRow } from "@/lib/db/schema-ai-proposals";

const MAX_IDS = 50;

/**
 * GET /api/ai/proposals?status=pending : propositions en attente (< 24 h) de l'utilisateur dans son organisation.
 * GET /api/ai/proposals?status=open : idem, plus les propositions périmées (stale) ou en échec (failed) de moins de 24 h.
 * GET /api/ai/proposals?ids=a,b : état (tous statuts) des seules propositions de l'utilisateur ; les autres sont ignorées.
 */
export async function GET(req: NextRequest) {
  try {
    const { user, orgId } = await sessionScope(req);
    const params = req.nextUrl.searchParams;
    const idsParam = params.get("ids");
    let rows: AiProposalRow[];
    if (idsParam !== null) {
      const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(isUuid))].slice(0, MAX_IDS);
      const found = await Promise.all(ids.map((id) => getOwnProposal({ id, userId: user.id, orgId })));
      rows = found.filter((r): r is AiProposalRow => r !== null);
    } else {
      const status = params.get("status") ?? "pending";
      if (status !== "pending" && status !== "open") {
        return NextResponse.json({ error: "Statut non pris en charge" }, { status: 400 });
      }
      rows =
        status === "open"
          ? await listOpenProposals({ userId: user.id, orgId })
          : await listPendingProposals({ userId: user.id, orgId });
    }
    return NextResponse.json({ proposals: await buildProposalViews(rows, user, orgId, req) });
  } catch (e) {
    return accessErrorResponse(e);
  }
}
