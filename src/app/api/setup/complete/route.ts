// src/app/api/setup/complete/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  clearInstallTokenCookie,
  guardSetupAccess,
  markSetupCompleted,
} from "@/lib/setup/guards";

export async function POST() {
  const access = await guardSetupAccess();
  if (!access.allowed) return access.response;

  // Vérifier qu'un super admin a été créé avant de finaliser
  const [adminRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.globalRole, "super_admin"))
    .limit(1);

  if (!adminRow) {
    return NextResponse.json(
      { error: "Un super administrateur doit être créé avant de finaliser la configuration" },
      { status: 400 }
    );
  }

  await markSetupCompleted();

  return clearInstallTokenCookie(NextResponse.json({ success: true }));
}
