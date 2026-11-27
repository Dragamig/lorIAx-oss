import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { CONTACT_SEARCH_MAX, loadContacts } from "@/lib/crm/contacts";

const querySchema = z.object({
  search: z.string().max(CONTACT_SEARCH_MAX).default(""),
  tz: z.string().max(64).optional(),
});

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const sp = new URL(req.url).searchParams;
  const parsed = querySchema.safeParse({
    search: sp.get("search") ?? undefined,
    tz: sp.get("tz") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides", code: "invalid_params" }, { status: 400 });
  }

  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  return NextResponse.json(await loadContacts(ctx, parsed.data));
}
