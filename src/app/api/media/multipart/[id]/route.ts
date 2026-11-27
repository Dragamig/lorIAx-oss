import { NextRequest, NextResponse } from "next/server";
import { abortUpload, getUploadState } from "@/lib/media/multipart";
import { NO_STORE, authContext, isUploadId, notFound } from "@/lib/media/multipart-http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** État de l'envoi (parts déjà reçues) pour reprendre après une coupure. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const ctx = await authContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!isUploadId(id)) return notFound();
  const state = await getUploadState(ctx.user, ctx.orgId, id);
  if (!state) return notFound();
  return NextResponse.json(state, { headers: NO_STORE });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const ctx = await authContext();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!isUploadId(id)) return notFound();
  if (!(await abortUpload(ctx.user, ctx.orgId, id))) return notFound();
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
