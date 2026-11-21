import { NextResponse, type NextRequest } from "next/server";
import { FolderError } from "@/lib/media/folders";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readJsonObject(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** FolderError => son statut ; tout le reste remonte (500). */
export function folderErrorResponse(e: unknown): NextResponse {
  if (e instanceof FolderError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}
