import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { revokeUserApiKeys } from "@/lib/auth/revoke-sessions";
import { validateNewPassword } from "@/lib/auth/password-policy";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const password = body?.password;
  const check = validateNewPassword(password);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password as string, 12);
  await db
    .update(users)
    .set({ passwordHash, mustResetPassword: false, tokenInvalidatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  await revokeUserApiKeys(session.user.id);

  return NextResponse.json({ ok: true });
}
