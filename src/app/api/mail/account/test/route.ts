import { NextResponse, type NextRequest } from "next/server";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { consumeQuota, peekQuotaExceeded } from "@/lib/rate-limit";
import { MASKED_SECRET } from "@/lib/settings/secrets";
import { accountInputSchema, getAccountFor, setAccountStatus, targetChanged } from "@/lib/mailing/accounts";
import { decryptAccountPassword } from "@/lib/mailing/account-secrets";
import { statusFromTest } from "@/lib/mailing/account-verify";
import { testMailConnection } from "@/lib/mailing/connection-test";

const bodySchema = accountInputSchema.pick({
  address: true,
  smtpHost: true,
  smtpPort: true,
  smtpSecurity: true,
  imapHost: true,
  imapPort: true,
  imapSecurity: true,
  password: true,
});

const TEST_TIER = [{ maxRequests: 10, windowMs: 3_600_000 }];

const badRequest = (code: string) =>
  NextResponse.json({ error: code === "password_required" ? code : "Corps invalide", code }, { status: 400 });

export async function POST(req: NextRequest) {
  let ctx;
  try {
    ctx = await requireOrgScoped({}, req);
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }
  const userId = ctx.user.id;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = undefined;
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return badRequest("invalid_body");
  const input = parsed.data;

  // Pré-vérification sans consommer, puis consommation : 10 tests par heure et par utilisateur.
  const key = `mail-test:${userId}`;
  if (await peekQuotaExceeded(key, TEST_TIER)) {
    return NextResponse.json({ error: "Trop de tests, réessayez plus tard", code: "rate_limited" }, { status: 429 });
  }
  await consumeQuota(key, TEST_TIER);

  const stored = await getAccountFor(ctx.orgId, userId);
  const usesStored = !input.password || input.password.trim() === "" || input.password === MASKED_SECRET;
  let storedPassword: string | null = null;
  if (stored?.passwordEnc) {
    try {
      storedPassword = decryptAccountPassword(stored);
    } catch {
      storedPassword = null;
    }
  }
  let password: string;
  if (usesStored) {
    // Le secret stocké ne part jamais vers une adresse ou un hôte modifié.
    if (stored && targetChanged(stored, input)) return badRequest("password_required");
    if (!storedPassword) return badRequest("password_required");
    password = storedPassword;
  } else {
    password = input.password as string;
  }

  const config = { ...input, password };
  const result = await testMailConnection(config);

  // Le statut du compte enregistré ne change que si on a testé exactement sa configuration.
  const isStoredConfig =
    !!stored &&
    storedPassword === password &&
    stored.address === input.address &&
    stored.smtpHost === input.smtpHost &&
    stored.smtpPort === input.smtpPort &&
    stored.smtpSecurity === input.smtpSecurity &&
    stored.imapHost === input.imapHost &&
    stored.imapPort === input.imapPort &&
    stored.imapSecurity === input.imapSecurity;
  if (isStoredConfig) {
    const { status, message } = statusFromTest(result);
    await setAccountStatus(ctx.orgId, userId, status, message);
  }
  return NextResponse.json(result);
}
