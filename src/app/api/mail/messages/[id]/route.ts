import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { getVisibleMail, toMessageDto } from "@/lib/mailing/threads";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireCrm({ level: "member", requireEnabled: false }, req);
  if (!access.ok) return access.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return notFound();
  const row = await getVisibleMail(access.orgId, access.user.id, id);
  if (!row) return notFound();
  return NextResponse.json({ message: toMessageDto(row) });
}
