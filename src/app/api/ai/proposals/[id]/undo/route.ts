import { NextResponse, type NextRequest } from "next/server";
import { undoProposal } from "@/lib/ai/proposals/undo";
import { accessErrorResponse, isUuid, notFound, sessionScope } from "@/lib/ai/proposals/route-utils";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, orgId } = await sessionScope(req);
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const out = await undoProposal({ proposalId: id, user, orgId, req });
    if (out.status === "refused") {
      return NextResponse.json({ code: "refused", error: out.message }, { status: 409 });
    }
    return NextResponse.json({ status: "undone" });
  } catch (e) {
    return accessErrorResponse(e);
  }
}
