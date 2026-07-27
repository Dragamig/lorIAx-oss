import { NextResponse } from "next/server";
import { processReminders } from "@/lib/calendar/notifications";

/**
 * POST /api/calendar-reminders
 * Process pending calendar reminders (called by cron every minute).
 * Protected by a shared secret to prevent unauthorized access.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // Fail-closed : sans CRON_SECRET configuré la route refuse, comme
  // /api/internal/org-plan-update. L'ancienne condition `cronSecret && ...`
  // laissait la route ouverte à tout le monde sur une installation où la variable
  // n'est pas définie, ce qui est justement le cas par défaut.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sent = await processReminders();

  return NextResponse.json({
    processed: sent,
    timestamp: new Date().toISOString(),
  });
}
