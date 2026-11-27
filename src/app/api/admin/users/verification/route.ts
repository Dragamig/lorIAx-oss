import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getOrgMemberIds } from "@/lib/org/org-members";
import { markEmailVerified, sendVerificationEmail } from "@/lib/auth/email-verification";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  const action = body?.action;
  if (!id) {
    return NextResponse.json({ error: "ID requis" }, { status: 400 });
  }
  if (action !== "resend" && action !== "mark_verified") {
    return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  }

  // Tenant scoping: only members of the request organisation, silent 404 otherwise.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 404 });
  }
  const memberIds = await getOrgMemberIds(orgId);
  if (!memberIds.includes(id)) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }
  if (target.emailVerifiedAt) {
    return NextResponse.json({ code: "already_verified" }, { status: 409 });
  }

  if (action === "mark_verified") {
    await markEmailVerified(target.id);
    return NextResponse.json({ success: true });
  }

  const result = await sendVerificationEmail({
    id: target.id,
    name: target.name,
    email: target.email,
  });
  return NextResponse.json({ success: true, ...result });
}
