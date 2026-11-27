import { NextRequest } from "next/server";
import { handleCinderRequest } from "@/lib/ai/cinder/engine";

// Alias conservé pour les onglets ouverts sur l'ancien bundle.
export async function POST(request: NextRequest) {
  try {
    return await handleCinderRequest(request, { scope: "help-alias" });
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : String(err);
    console.error("[AI help] Unhandled error:", msg);
    return new Response(msg, { status: 500 });
  }
}
