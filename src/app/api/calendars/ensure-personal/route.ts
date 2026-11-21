// loriax-app/src/app/api/calendars/ensure-personal/route.ts
// Crée un calendrier personnel pour l'utilisateur si absent (utilisé par l'étape 5 du tour).

import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import slugify from "slugify";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [existing] = await db
    .select()
    .from(calendars)
    .where(
      and(eq(calendars.ownerUserId, user.id), eq(calendars.type, "personal")),
    )
    .limit(1);

  if (existing) {
    return NextResponse.json({ ok: true, calendarId: existing.id, created: false });
  }

  const baseSlug =
    slugify(`${user.name ?? user.email ?? "user"}-perso`, { lower: true, strict: true }) ||
    "perso";
  const caldavSlug = `${baseSlug}-${user.id.slice(0, 8)}`;

  const [cal] = await db
    .insert(calendars)
    .values({
      name: "Mon calendrier",
      type: "personal",
      ownerUserId: user.id,
      color: "#6366f1",
      caldavSlug,
      isDefault: true,
    })
    .returning();

  return NextResponse.json({ ok: true, calendarId: cal.id, created: true });
}
