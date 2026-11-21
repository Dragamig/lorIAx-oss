import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWebhookAutomation, tallyErrorResponse } from "@/lib/integrations/tally/access";
import { getTallyClientForOrg } from "@/lib/integrations/tally/key-store";
import { isPrivateUrl } from "@/lib/security/url-validator";

const bodySchema = z.object({
  automationId: z.string().uuid(),
  formId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

/**
 * « Brancher Tally » : crée le webhook côté Tally vers l'URL de l'automatisme,
 * avec l'en-tête X-Webhook-Secret lu ici, côté serveur (jamais renvoyé au client).
 * Un branchement existant (même URL, même formulaire) n'est pas dupliqué.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
  const { automationId, formId } = parsed.data;

  const r = await resolveWebhookAutomation(automationId);
  if ("response" in r) return r.response;
  const cfg = (r.automation.triggerConfig ?? {}) as { token?: string; secret?: string };
  if (!cfg.token) return NextResponse.json({ error: "Webhook entrant non initialisé" }, { status: 409 });

  const base = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
  let hookUrl: URL;
  try {
    hookUrl = new URL(`${base}/api/automations/hook/${cfg.token}`);
  } catch {
    return NextResponse.json({ error: "URL publique de l'instance non configurée" }, { status: 409 });
  }
  if (hookUrl.protocol !== "https:" || isPrivateUrl(hookUrl)) {
    return NextResponse.json(
      { error: "Tally ne peut joindre qu'une adresse publique en HTTPS : branchez le webhook à la main", code: "not_public" },
      { status: 409 }
    );
  }

  const client = await getTallyClientForOrg(r.ctx.orgId);
  if (!client) return NextResponse.json({ error: "Tally n'est pas connecté", code: "not_connected" }, { status: 409 });
  try {
    const existing = (await client.listWebhooks()).find((w) => w.url === hookUrl.toString() && w.formId === formId);
    if (existing) return NextResponse.json({ connected: true, alreadyConnected: true });
    await client.createWebhook({
      formId,
      url: hookUrl.toString(),
      headers: cfg.secret ? [{ name: "X-Webhook-Secret", value: cfg.secret }] : [],
    });
    return NextResponse.json({ connected: true, alreadyConnected: false }, { status: 201 });
  } catch (e) {
    return tallyErrorResponse(e);
  }
}
