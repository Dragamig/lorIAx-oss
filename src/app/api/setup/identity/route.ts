// src/app/api/setup/identity/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { guardSetupRoute } from "@/lib/setup/guards";

export async function POST(request: NextRequest) {
  const blocked = await guardSetupRoute(request);
  if (blocked) return blocked;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { name, description, logoUrl, faviconUrl } = body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json(
      { error: "Le nom de l'organisation est obligatoire" },
      { status: 400 }
    );
  }

  // Validate logoUrl and faviconUrl are valid HTTP(S) URLs
  const isValidUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  if (logoUrl && !isValidUrl(logoUrl)) {
    return NextResponse.json(
      { error: "L'URL du logo doit être une URL HTTP(S) valide" },
      { status: 400 }
    );
  }

  if (faviconUrl && !isValidUrl(faviconUrl)) {
    return NextResponse.json(
      { error: "L'URL du favicon doit être une URL HTTP(S) valide" },
      { status: 400 }
    );
  }

  const now = new Date();
  const entries: Array<{ key: string; value: unknown }> = [
    { key: "org_name", value: name.trim() },
    { key: "org_description", value: description?.trim() || "" },
  ];

  // Only store logo/favicon if provided (avoid SQL null on jsonb NOT NULL column)
  if (logoUrl) entries.push({ key: "org_logo_url", value: logoUrl });
  if (faviconUrl) entries.push({ key: "org_favicon_url", value: faviconUrl });

  for (const entry of entries) {
    await db
      .insert(systemSettings)
      .values({ key: entry.key, value: entry.value, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: entry.value, updatedAt: now },
      });
  }

  return NextResponse.json({ success: true });
}
