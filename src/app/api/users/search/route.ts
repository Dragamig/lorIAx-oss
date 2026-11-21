import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { ilike, or, inArray, and } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getOrgMemberIds } from "@/lib/org/org-members";

const SELECT_FIELDS = {
  id: users.id,
  name: users.name,
  email: users.email,
  avatarUrl: users.avatarUrl,
} as const;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json([], { status: 401 });

  // Cloisonnement multi-tenant : l'annuaire est restreint aux membres de
  // l'organisation du sous-domaine courant.
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json([], { status: 404 });
  const memberIds = await getOrgMemberIds(orgId);
  if (memberIds.length === 0) return NextResponse.json([]);

  // Résolution par lot d'IDs (ex. affichage des chips d'une colonne « Personne »)
  const idsParam = request.nextUrl.searchParams.get("ids");
  if (idsParam) {
    const ids = idsParam
      .split(",")
      .map((s) => s.trim())
      .filter((id) => id && memberIds.includes(id));
    if (ids.length === 0) return NextResponse.json([]);
    const resolved = await db
      .select(SELECT_FIELDS)
      .from(users)
      .where(inArray(users.id, ids.slice(0, 100)));
    return NextResponse.json(resolved);
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "10");

  if (q.length < 1) {
    return NextResponse.json([]);
  }

  const pattern = `%${q}%`;
  const results = await db
    .select(SELECT_FIELDS)
    .from(users)
    .where(
      and(
        inArray(users.id, memberIds),
        or(ilike(users.name, pattern), ilike(users.email, pattern))
      )
    )
    .limit(limit);

  return NextResponse.json(results);
}
