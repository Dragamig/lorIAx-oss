import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { readJsonObject } from "@/lib/media/folders-http";
import { CHECKSUM_RE, DUPLICATE_CHECKSUMS_MAX, findDuplicates } from "@/lib/media/duplicates";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const orgId = await getRequestOrgId(user);
  if (!orgId) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  const body = await readJsonObject(req);
  if (!body) return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  const sums = body.checksums;
  if (!Array.isArray(sums) || sums.length > DUPLICATE_CHECKSUMS_MAX) {
    return NextResponse.json(
      { error: `checksums : tableau de ${DUPLICATE_CHECKSUMS_MAX} sommes au plus` },
      { status: 400 }
    );
  }
  if (!sums.every((s) => typeof s === "string" && CHECKSUM_RE.test(s))) {
    return NextResponse.json({ error: "Somme SHA-256 invalide" }, { status: 400 });
  }
  const duplicates = await findDuplicates(user, orgId, sums as string[]);
  return NextResponse.json({ duplicates }, { headers: { "Cache-Control": "private, no-store" } });
}
