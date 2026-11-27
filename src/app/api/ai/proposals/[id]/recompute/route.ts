import { NextResponse, type NextRequest } from "next/server";
import { recomputeProposal } from "@/lib/ai/proposals/recompute";
import { accessErrorResponse, isUuid, notFound, sessionScope } from "@/lib/ai/proposals/route-utils";
import { buildProposalViews } from "@/lib/ai/proposals/view";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, orgId } = await sessionScope(req);
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const out = await recomputeProposal({ proposalId: id, user, orgId, req });
    switch (out.status) {
      case "recomputed": {
        const [proposal] = await buildProposalViews([out.proposal], user, orgId, req);
        if (!proposal) return notFound();
        return NextResponse.json({ proposal });
      }
      case "refused":
        return NextResponse.json({ code: "refused", error: out.message }, { status: 409 });
      case "plan_failed":
        return NextResponse.json({ code: "plan_failed", error: out.message }, { status: 422 });
      case "not_applicable":
        return NextResponse.json({ code: "not_applicable", error: out.message }, { status: 400 });
    }
  } catch (e) {
    return accessErrorResponse(e);
  }
}
