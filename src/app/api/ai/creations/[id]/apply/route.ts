import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applyCreation } from "@/lib/ai/creation/apply";
import { creationOverridesSchema } from "@/lib/ai/creation/schemas";
import { accessErrorResponse, isUuid, notFound, sessionScope } from "@/lib/ai/proposals/route-utils";

/** Corps strict : tout autre champ (dont userId ou orgId) est refusé. */
const bodySchema = z.object({ overrides: creationOverridesSchema.optional() }).strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, orgId } = await sessionScope(req);
    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const raw = await req.text();
    let overrides: unknown;
    if (raw.trim() !== "") {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
      }
      const parsed = bodySchema.safeParse(json);
      if (!parsed.success) return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
      overrides = parsed.data.overrides;
    }

    const out = await applyCreation({ proposalId: id, user, orgId, overrides, req });
    switch (out.status) {
      case "applied":
        return NextResponse.json({ status: "applied", result: out.result });
      case "not_found":
        return notFound();
      case "invalid":
        return NextResponse.json({ code: "invalid", error: out.message }, { status: 400 });
      case "refused":
        return NextResponse.json({ code: "refused", error: out.message }, { status: 409 });
      case "failed":
        return NextResponse.json({ code: "failed", error: out.message }, { status: 422 });
    }
  } catch (e) {
    return accessErrorResponse(e);
  }
}
