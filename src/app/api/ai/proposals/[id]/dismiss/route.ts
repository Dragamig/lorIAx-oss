import { NextResponse, type NextRequest } from "next/server";
import { accessErrorResponse, isUuid, notFound, sessionScope } from "@/lib/ai/proposals/route-utils";
import { dismissProposal, getOwnProposal } from "@/lib/ai/proposals/store";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, orgId } = await sessionScope(req);
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const own = await getOwnProposal({ id, userId: user.id, orgId });
    if (!own) return notFound();
    const done = await dismissProposal({ id, userId: user.id, orgId });
    if (!done) {
      return NextResponse.json(
        { code: "refused", error: "Proposition déjà traitée ou en cours d'application" },
        { status: 409 },
      );
    }
    return NextResponse.json({ status: "dismissed" });
  } catch (e) {
    return accessErrorResponse(e);
  }
}
