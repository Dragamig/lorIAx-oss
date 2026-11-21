import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { MetadataError, getMediaDetail, updateMedia } from "@/lib/media/metadata";
import { TagError } from "@/lib/media/tags";
import { UUID_RE, readJsonObject } from "@/lib/media/folders-http";
import type { SessionUser } from "@/types";

const patchSchema = z
  .object({
    title: z.string().nullable().optional(),
    altText: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    filename: z.string().optional(),
    folderId: z.string().regex(UUID_RE).nullable().optional(),
    tags: z.array(z.string()).optional(),
    spaceId: z.string().regex(UUID_RE).nullable().optional(),
  })
  .strict();

const NO_STORE = { "Cache-Control": "private, no-store" };

type Ctx = { ok: true; user: SessionUser; orgId: string } | { ok: false; res: NextResponse };

async function context(id: string): Promise<Ctx> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, res: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
  }
  const orgId = await getRequestOrgId(user);
  if (!orgId || !UUID_RE.test(id)) {
    return { ok: false, res: NextResponse.json({ error: "Média introuvable" }, { status: 404 }) };
  }
  return { ok: true, user, orgId };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await context(id);
  if (!c.ok) return c.res;
  const detail = await getMediaDetail(c.user, c.orgId, id);
  if (!detail) return NextResponse.json({ error: "Média introuvable" }, { status: 404 });
  return NextResponse.json({ media: detail }, { headers: NO_STORE });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await context(id);
  if (!c.ok) return c.res;
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Champs invalides" }, { status: 400 });
  try {
    const detail = await updateMedia(c.user, c.orgId, id, parsed.data);
    return NextResponse.json({ media: detail }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof MetadataError || e instanceof TagError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
