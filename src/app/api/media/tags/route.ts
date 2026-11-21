import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { createTag, listTags, TagError } from "@/lib/media/tags";
import { readJsonObject } from "@/lib/media/folders-http";

function tagErrorResponse(e: unknown): NextResponse {
  if (e instanceof TagError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  try {
    const tags = await listTags(user, orgId);
    return NextResponse.json({ tags }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return tagErrorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  try {
    const tag = await createTag(user, orgId, body.label);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (e) {
    return tagErrorResponse(e);
  }
}
