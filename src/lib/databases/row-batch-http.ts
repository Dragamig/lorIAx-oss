import { NextResponse } from "next/server";
import { RowBatchError } from "./row-batch";

/** Code SQLSTATE d'une erreur pg, y compris enveloppée (`cause`). */
function pgCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Traduit une erreur d'opération en lot en réponse HTTP, ou renvoie null si
 * l'erreur n'est pas gérée. Deadlock / violation d'unicité : 409 (400 générique
 * pour la restauration, qui ne doit jamais révéler l'existence d'un id).
 */
export function rowBatchErrorResponse(e: unknown, opts: { restore?: boolean } = {}): NextResponse | null {
  if (e instanceof RowBatchError) {
    if (e.code === "not_found") return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    if (opts.restore) return NextResponse.json({ error: "Restauration impossible" }, { status: 400 });
    return NextResponse.json({ error: e.message }, { status: e.code === "conflict" ? 409 : 400 });
  }
  const code = pgCode(e);
  if (code === "23505") {
    return opts.restore
      ? NextResponse.json({ error: "Restauration impossible" }, { status: 400 })
      : NextResponse.json({ error: "Conflit, réessayez" }, { status: 409 });
  }
  if (code === "40P01") return NextResponse.json({ error: "Conflit, réessayez" }, { status: 409 });
  return null;
}
