import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { resolveFicheContext } from "@/lib/mailing/crm-trace";
import { getAccountFor } from "@/lib/mailing/accounts";
import { peekMailQuota } from "@/lib/mailing/quota";
import { getTraceAlert } from "@/lib/mailing/tick";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });
const query = z.object({ databaseId: z.string().uuid(), rowId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;
  const parsed = query.safeParse({
    databaseId: req.nextUrl.searchParams.get("databaseId"),
    rowId: req.nextUrl.searchParams.get("rowId"),
  });
  if (!parsed.success) return notFound();

  const fiche = await resolveFicheContext(access.orgId, access.user.id, parsed.data);
  if (!fiche) return notFound();

  const [account, quota, alert] = await Promise.all([
    getAccountFor(access.orgId, access.user.id),
    peekMailQuota(access.orgId, access.user.id),
    getTraceAlert(access.orgId, access.user.id),
  ]);

  return NextResponse.json({
    // Scope of the local compose draft: a draft never crosses users or organizations.
    viewer: { orgId: access.orgId, userId: access.user.id },
    role: fiche.role,
    contact: { rowId: fiche.contactRowId, name: fiche.contactName, email: fiche.contactEmail },
    dossiers: fiche.dossiers.map((d) => ({ rowId: d.rowId, title: d.title, updatedAt: d.updatedAt.toISOString() })),
    defaultDossierRowId: fiche.defaultDossierRowId,
    fixedDossierRowId: fiche.fixedDossierRowId,
    mailbox: {
      configured: Boolean(account),
      address: account?.address ?? null,
      signature: account?.signature ?? "",
      cancelDelaySeconds: account?.cancelDelaySeconds ?? 10,
    },
    quota: { limit: quota.limit, exceeded: quota.exceeded },
    alert,
  });
}
