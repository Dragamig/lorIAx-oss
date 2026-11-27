import { NextResponse, type NextRequest } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { ToolAccessError } from "@/lib/ai/chat-tools/context";
import { ApplyBodyError } from "./apply";
import type { SessionUser } from "@/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string): boolean {
  return UUID.test(v);
}

export const NOT_FOUND_BODY = { error: "Introuvable" };

export function notFound(): NextResponse {
  return NextResponse.json(NOT_FOUND_BODY, { status: 404 });
}

/**
 * Identité et organisation tirées UNIQUEMENT de la session et de l'en-tête de sous-domaine :
 * jamais d'identifiant utilisateur ou organisation lu dans le corps ou la requête.
 */
export async function sessionScope(req: NextRequest): Promise<{ user: SessionUser; orgId: string }> {
  const s = await requireOrgScoped({}, req);
  return { user: s.user, orgId: s.orgId };
}

/** Traduit les erreurs d'accès connues en réponses ; relance les autres. */
export function accessErrorResponse(e: unknown): NextResponse {
  if (e instanceof OrgScopeError) return e.response;
  if (e instanceof ToolAccessError) {
    return e.code === "forbidden"
      ? NextResponse.json({ error: "Accès refusé" }, { status: 403 })
      : notFound();
  }
  if (e instanceof ApplyBodyError) return NextResponse.json({ error: e.message }, { status: 400 });
  throw e;
}
