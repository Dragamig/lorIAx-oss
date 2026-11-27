import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { retryFailed } from "@/lib/mailing/retry";
import { getVisibleMail } from "@/lib/mailing/threads";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });
const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, code, ...extra }, { status });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCrm({ level: "member", requireEnabled: false }, req);
  if (!access.ok) return access.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return notFound();

  const result = await retryFailed(access.orgId, access.user.id, id);
  if (result.ok) return NextResponse.json({ id, status: "scheduled" });

  switch (result.reason) {
    case "not_found":
      return notFound();
    case "not_failed": {
      const row = await getVisibleMail(access.orgId, access.user.id, id);
      if (!row) return notFound();
      return fail(409, "not_failed", "Le mail n'est pas en échec", { status: row.status });
    }
    case "delivery_unknown":
      return fail(409, "delivery_unknown", "L'envoi est incertain, le mail a peut-être été remis");
    case "no_account":
      return fail(409, "no_account", "Aucune boîte mail configurée");
    case "quota":
      return NextResponse.json({ error: "Quota d'envoi atteint", code: result.code, limit: result.limit }, { status: 429 });
    default: {
      const unhandled: never = result;
      console.error("[mail/retry] raison de réessai inconnue", unhandled);
      return fail(500, "internal", "Erreur interne");
    }
  }
}
