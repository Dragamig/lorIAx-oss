import { NextResponse, type NextRequest } from "next/server";
import { countPendingCreationProposals, getOwnCreationProposal, markRestored } from "@/lib/ai/creation/store";
import { MAX_PENDING_CREATIONS } from "@/lib/ai/chat-tools/create-tools";
import { accessErrorResponse, isUuid, notFound, sessionScope } from "@/lib/ai/proposals/route-utils";

const REFUSED = { code: "refused", error: "Cette proposition ne peut plus être rétablie" };

/** Repasse une proposition ignorée en attente, tant qu'elle n'est pas échue. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, orgId } = await sessionScope(req);
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const proposal = await getOwnCreationProposal(orgId, user.id, id);
    if (!proposal) return notFound();
    if (proposal.status !== "dismissed") return NextResponse.json(REFUSED, { status: 409 });
    if ((await countPendingCreationProposals(orgId, user.id)) >= MAX_PENDING_CREATIONS) {
      return NextResponse.json(
        {
          code: "too_many_pending",
          error: `Vous avez déjà ${MAX_PENDING_CREATIONS} propositions de création en attente : validez ou ignorez-en avant d'en rétablir une`,
        },
        { status: 409 },
      );
    }
    if (!(await markRestored(id, orgId, user.id))) return NextResponse.json(REFUSED, { status: 409 });
    return NextResponse.json({ status: "pending" });
  } catch (e) {
    return accessErrorResponse(e);
  }
}
