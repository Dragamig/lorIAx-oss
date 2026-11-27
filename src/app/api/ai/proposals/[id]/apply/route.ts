import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { applyProposal } from "@/lib/ai/proposals/apply";
import { accessErrorResponse, isUuid, notFound, sessionScope } from "@/lib/ai/proposals/route-utils";

/** Corps strict : tout autre champ (dont userId ou orgId) est refusé. */
const bodySchema = z
  .object({
    overrides: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    excludedGroupIds: z.array(z.string()).optional(),
  })
  .strict();

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, orgId } = await sessionScope(req);
    const { id } = await params;
    if (!isUuid(id)) return notFound();

    const raw = await req.text();
    let body: z.infer<typeof bodySchema> | undefined;
    if (raw.trim() !== "") {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
      }
      const parsed = bodySchema.safeParse(json);
      if (!parsed.success) return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
      body = parsed.data;
    }

    const out = await applyProposal({ proposalId: id, user, orgId, body, req });
    switch (out.status) {
      case "applied":
        return NextResponse.json({ status: "applied", summary: out.summary });
      case "stale":
        return NextResponse.json({ code: "stale", error: out.message }, { status: 409 });
      case "refused":
        return NextResponse.json({ code: "refused", error: out.message }, { status: 409 });
      case "expired":
        return NextResponse.json({ code: "expired", error: out.message }, { status: 409 });
      case "failed":
        return NextResponse.json({ code: "failed", error: out.message }, { status: 422 });
    }
  } catch (e) {
    return accessErrorResponse(e);
  }
}
