import { NextResponse, type NextRequest } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { auditLog } from "@/lib/audit/log";
import { getClientIpOrNull, peekQuotaExceeded, consumeQuota } from "@/lib/rate-limit";
import { verifyStoredAccount } from "@/lib/mailing/account-verify";
import { toClientAccount } from "@/lib/mailing/account-secrets";
import { accountInputSchema, getAccountFor, upsertAccount, deleteAccount, PasswordRequiredError } from "@/lib/mailing/accounts";

// Compteur propre à l'enregistrement (distinct de celui du bouton Tester) : 60 vérifications sortantes
// par heure et par utilisateur, large pour des corrections successives, borné contre le scan de ports.
const SAVE_TIER = [{ maxRequests: 60, windowMs: 3_600_000 }];
const SAVE_KEY = (userId: string) => `mail-account-save:${userId}`;

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

async function scope(req: NextRequest) {
  try {
    return { ctx: await requireOrgScoped({}, req) };
  } catch (e) {
    if (e instanceof OrgScopeError) return { response: e.response };
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const s = await scope(req);
  if (!s.ctx) return s.response;
  const row = await getAccountFor(s.ctx.orgId, s.ctx.user.id);
  return NextResponse.json({ account: row ? toClientAccount(row) : null });
}

export async function PUT(req: NextRequest) {
  const s = await scope(req);
  if (!s.ctx) return s.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  const parsed = accountInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide", code: "invalid_body" }, { status: 400 });
  }
  // Quota vérifié avant toute écriture : un 429 ne laisse jamais de compte à moitié enregistré.
  if (await peekQuotaExceeded(SAVE_KEY(s.ctx.user.id), SAVE_TIER)) {
    return NextResponse.json(
      { error: "Trop d'enregistrements, rien n'a été modifié, réessayez plus tard", code: "rate_limited" },
      { status: 429 },
    );
  }
  let row;
  try {
    row = await upsertAccount(s.ctx.orgId, s.ctx.user.id, parsed.data);
  } catch (e) {
    if (e instanceof PasswordRequiredError) {
      return NextResponse.json({ error: "password_required", code: "password_required" }, { status: 400 });
    }
    throw e;
  }
  // Une connexion nouvelle ou modifiée est testée tout de suite : la boîte est ok ou en erreur, jamais bloquée en « non vérifiée ».
  if (row.status === "unverified") {
    await consumeQuota(SAVE_KEY(s.ctx.user.id), SAVE_TIER);
    row = await verifyStoredAccount(s.ctx.orgId, s.ctx.user.id, row);
  }
  const { password: _password, ...safe } = parsed.data;
  void _password;
  auditLog(
    "mail.account.update",
    s.ctx.user.id,
    { organizationId: s.ctx.orgId, accountId: row.id, ...safe },
    getClientIpOrNull(req) ?? undefined,
  );
  return NextResponse.json({ account: toClientAccount(row) });
}

export async function DELETE(req: NextRequest) {
  const s = await scope(req);
  if (!s.ctx) return s.response;
  const removed = await deleteAccount(s.ctx.orgId, s.ctx.user.id);
  if (!removed) return notFound();
  auditLog(
    "mail.account.delete",
    s.ctx.user.id,
    { organizationId: s.ctx.orgId },
    getClientIpOrNull(req) ?? undefined,
  );
  return NextResponse.json({ ok: true });
}
