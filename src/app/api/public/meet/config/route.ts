import { NextResponse } from "next/server";
import { getLiveKitConfig } from "@/lib/meet/livekit-config";

/**
 * GET /api/public/meet/config
 * Returns LiveKit server URL for guest WebRTC connection.
 * Resolved via getLiveKitConfig() (system_settings DB, env fallback).
 * No authentication required.
 */
export async function GET(): Promise<NextResponse> {
  const { livekitUrl } = await getLiveKitConfig();

  return NextResponse.json({ url: livekitUrl }, { status: 200 });
}
