import { NextRequest } from "next/server";
import { handleCinderRequest } from "@/lib/ai/cinder/engine";

export async function POST(request: NextRequest) {
  try {
    return await handleCinderRequest(request, { scope: "full" });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
    console.error("[AI chat] Unhandled error:", msg);
    return new Response(msg, { status: 500 });
  }
}
