import { NextResponse, type NextRequest } from "next/server";
import { getOwnCreationProposal, markDismissed } from "@/lib/ai/creation/store";
import { accessErrorResponse, isUuid, notFound, sessionScope } from "@/lib/ai/proposals/route-utils";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, orgId } = await sessionScope(req);
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const proposal = await getOwnCreationProposal(orgId, user.id, id);
    if (!proposal) return notFound();
    if (proposal.status !== "pending") {
      return NextResponse.json(
        { code: "refused", error: "Cette proposition ne peut plus être ignorée" },
        { status: 409 },
      );
    }
    if (!(await markDismissed(id))) {
      const current = await getOwnCreationProposal(orgId, user.id, id);
      return NextResponse.json(
        {
          code: "refused",
          error: "Cette proposition ne peut plus être ignorée",
          status: current?.status ?? "unknown",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "dismissed" });
  } catch (e) {
    return accessErrorResponse(e);
  }
}
