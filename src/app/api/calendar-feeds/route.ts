import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calendarExternalFeeds } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { z } from "zod";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const feeds = await db
    .select()
    .from(calendarExternalFeeds)
    .where(eq(calendarExternalFeeds.userId, user.id))
    .orderBy(calendarExternalFeeds.name);

  return NextResponse.json(feeds);
}

const createFeedSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = createFeedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [feed] = await db
    .insert(calendarExternalFeeds)
    .values({
      userId: user.id,
      name: parsed.data.name,
      url: parsed.data.url,
      color: parsed.data.color || "#6b7280",
      syncIntervalMinutes: parsed.data.syncIntervalMinutes || 60,
    })
    .returning();

  return NextResponse.json(feed, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  // Cloisonnement (AZ-20) : l'appartenance fait partie de la clause `where` de
  // la suppression elle-même, jamais d'un test préalable. Aucune fenêtre entre
  // la vérification et l'effacement, et un identifiant appartenant à un autre
  // utilisateur ne supprime rien.
  const supprimes = await db
    .delete(calendarExternalFeeds)
    .where(
      and(
        eq(calendarExternalFeeds.id, id),
        eq(calendarExternalFeeds.userId, user.id)
      )
    )
    .returning({ id: calendarExternalFeeds.id });

  if (supprimes.length === 0) {
    return NextResponse.json({ error: "Flux introuvable" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
