import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const [row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);
  return row ? (row.value as T) : null;
}

export async function setSetting<T = unknown>(key: string, value: T): Promise<void> {
  await db
    .insert(systemSettings)
    .values({ key, value: value as unknown as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: value as unknown as object, updatedAt: new Date() },
    });
}
