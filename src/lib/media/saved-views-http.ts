import { NextResponse } from "next/server";
import { SavedViewError } from "@/lib/media/saved-views";

/** SavedViewError => son statut ; tout le reste remonte (500). */
export function savedViewErrorResponse(e: unknown): NextResponse {
  if (e instanceof SavedViewError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}
