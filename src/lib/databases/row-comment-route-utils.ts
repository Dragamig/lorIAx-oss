import { NextResponse } from "next/server";
import { RowCommentError } from "./row-comments";
import { isUuid } from "./row-history-read";

export const notFoundResponse = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });
export const invalidCommentResponse = () =>
  NextResponse.json({ error: "Commentaire invalide" }, { status: 400 });

export { isUuid };

/** Traduit une RowCommentError en 403 ou 404 ; relance toute autre erreur. */
export function commentErrorResponse(e: unknown): NextResponse {
  if (e instanceof RowCommentError) {
    return e.code === "forbidden"
      ? NextResponse.json({ error: "Accès refusé" }, { status: 403 })
      : notFoundResponse();
  }
  throw e;
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}
