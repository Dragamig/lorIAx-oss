// src/app/api/setup/complete/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemSettings, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { guardSetupRoute } from "@/lib/setup/guards";
import { consumeBootstrapToken } from "@/lib/setup/bootstrap-token";

export async function POST(request: NextRequest) {
  const blocked = await guardSetupRoute(request);
  if (blocked) return blocked;

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

  const now = new Date();
  await db
    .insert(systemSettings)
    .values({ key: "setup_completed", value: true, updatedAt: now })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: true, updatedAt: now },
    });

  // Usage unique : le jeton d'amorçage n'est consommé qu'ICI, une fois
  // l'installation réellement terminée. Un échec en cours de parcours laisse
  // donc le jeton valide et l'exploitant peut reprendre l'assistant. Une
  // installation définitivement bloquée serait pire que le défaut corrigé.
  await consumeBootstrapToken();

  return NextResponse.json({ success: true });
}
