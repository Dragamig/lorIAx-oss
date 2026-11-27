import { NextResponse, type NextRequest } from "next/server";
import { accessErrorResponse, isUuid, sessionScope } from "@/lib/ai/proposals/route-utils";
import { getOwnCreationProposal } from "@/lib/ai/creation/store";
import { buildCreationViews } from "@/lib/ai/creation-view";

const MAX_IDS = 50;

/** GET /api/ai/creations?ids=a,b : état des seules propositions de création de l'utilisateur ; les autres sont ignorées. */
export async function GET(req: NextRequest) {
  try {
    const { user, orgId } = await sessionScope(req);
    const idsParam = req.nextUrl.searchParams.get("ids");
    if (idsParam === null) return NextResponse.json({ error: "Paramètre ids requis" }, { status: 400 });
    const ids = [...new Set(idsParam.split(",").map((s) => s.trim()).filter(isUuid))].slice(0, MAX_IDS);
    const found = await Promise.all(ids.map((id) => getOwnCreationProposal(orgId, user.id, id)));
    const rows = found.filter((r): r is NonNullable<typeof r> => r !== null);
    return NextResponse.json({ creations: await buildCreationViews(rows, user, orgId, req) });
  } catch (e) {
    return accessErrorResponse(e);
  }
}
