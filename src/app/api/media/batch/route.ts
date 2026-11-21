import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { UUID_RE, readJsonObject } from "@/lib/media/folders-http";
import { BATCH_MAX_IDS, BatchError, runBatch } from "@/lib/media/batch";
import { TagError } from "@/lib/media/tags";

const ids = z.array(z.string().regex(UUID_RE)).min(1).max(BATCH_MAX_IDS);
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), ids, folderId: z.string().regex(UUID_RE).nullable() }).strict(),
  z.object({ action: z.literal("tag"), ids, tags: z.array(z.string()).min(1).max(20) }).strict(),
  z
    .object({ action: z.literal("untag"), ids, tagIds: z.array(z.string().regex(UUID_RE)).min(1).max(100) })
    .strict(),
  z.object({ action: z.literal("trash"), ids }).strict(),
  z.object({ action: z.literal("restore"), ids }).strict(),
]);

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Action ou identifiants invalides (${BATCH_MAX_IDS} médias au plus)` },
      { status: 400 }
    );
  }
  try {
    const result = await runBatch(user, orgId, parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof BatchError || e instanceof TagError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
