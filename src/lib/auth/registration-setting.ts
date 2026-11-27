import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Fail-closed: registration is open only when `system_settings.auth` holds
 * `allowRegistration === true`. A missing row, a non-boolean value or a read
 * error all mean "closed".
 */
export async function isRegistrationOpen(): Promise<boolean> {
  try {
    const rows = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, "auth"))
      .limit(1);
    const value = rows[0]?.value as { allowRegistration?: unknown } | null | undefined;
    return value?.allowRegistration === true;
  } catch {
    return false;
  }
}
