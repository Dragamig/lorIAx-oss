import { NextResponse, type NextRequest } from "next/server";
import { and, asc, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { organizationMembers } from "@/lib/db/schema-org";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { makeCanView } from "@/lib/databases/row-eligibility";
import { escapeLike } from "@/lib/databases/like-escape";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 10;
const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const MAX_QUERY_LENGTH = 100;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ databaseId: string }> }
) {
  const { databaseId } = await params;
  const scope = await requireRowScope(request, { databaseId, min: "viewer" });
  if (scope instanceof NextResponse) return scope;

  const sp = request.nextUrl.searchParams;
  let limit = DEFAULT_LIMIT;
  const rawLimit = sp.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) return NextResponse.json({ error: "Limite invalide" }, { status: 400 });
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIMIT) return NextResponse.json({ error: "Limite invalide" }, { status: 400 });
  }

  const q = (sp.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const orgFilter = eq(organizationMembers.organizationId, scope.orgId);
  // Nom seulement : une recherche par courriel permettrait de le reconstituer prefixe par prefixe.
  const where = q ? and(orgFilter, ilike(users.name, `%${escapeLike(q)}%`)) : orgFilter;

  const canView = makeCanView(scope.spaceId);
  const out: Array<{ id: string; name: string; avatarUrl: string | null }> = [];
  for (let page = 0; page < MAX_PAGES && out.length < limit; page++) {
    const candidates = await db
      .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
      .from(users)
      .innerJoin(organizationMembers, eq(organizationMembers.userId, users.id))
      .where(where)
      .orderBy(asc(users.name), asc(users.id))
      .limit(PAGE_SIZE)
      .offset(page * PAGE_SIZE);
    for (const c of candidates) {
      if (out.length >= limit) break;
      if (await canView(c.id)) out.push({ id: c.id, name: c.name, avatarUrl: c.avatarUrl });
    }
    if (candidates.length < PAGE_SIZE) break;
  }
  return NextResponse.json(out);
}
