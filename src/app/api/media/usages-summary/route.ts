import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { UUID_RE, readJsonObject } from "@/lib/media/folders-http";
import { getLibrarySettings } from "@/lib/media/library-settings";
import { SUMMARY_MAX_IDS, summarizeUsages } from "@/lib/media/usage-links";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  const body = await readJsonObject(req);
  const ids = body?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length > SUMMARY_MAX_IDS ||
    !ids.every((i) => typeof i === "string" && UUID_RE.test(i))
  ) {
    return NextResponse.json({ error: "Identifiants invalides (200 au plus)" }, { status: 400 });
  }
  const result = await summarizeUsages(user, orgId, ids as string[]);
  const { trashRetentionDays } = await getLibrarySettings();
  return NextResponse.json({ ...result, trashRetentionDays }, { headers: { "Cache-Control": "private, no-store" } });
}
