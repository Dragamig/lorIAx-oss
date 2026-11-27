import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { cancelScheduled } from "@/lib/mailing/outbox";
import { getVisibleMail } from "@/lib/mailing/threads";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCrm({ level: "member", requireEnabled: false }, req);
  if (!access.ok) return access.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return notFound();

  if (await cancelScheduled(access.orgId, access.user.id, id)) {
    return NextResponse.json({ id, status: "cancelled" });
  }
  // Pas annulé : soit ce n'est pas le mail de l'utilisateur (404 muet), soit il est déjà parti (409).
  const row = await getVisibleMail(access.orgId, access.user.id, id);
  if (!row) return notFound();
  return NextResponse.json({ error: "Le mail est déjà parti", code: "already_sent", status: row.status }, { status: 409 });
}
