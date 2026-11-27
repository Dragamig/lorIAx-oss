import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabaseAutomations } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getSetting } from "@/lib/settings/system-settings";
import { executeAutomation } from "@/lib/automations/executor";
import { verifyWebhookSecret, buildWebhookPayload, buildLastReceived, tallyFormIdMismatch } from "@/lib/automations/webhook-inbound";
import { markSubmissionDone, releaseSubmission, reserveSubmission, tallyResponseIdFromBody } from "@/lib/integrations/tally/submission-claims";
import type { AutomationRow } from "@/lib/automations/actions/types";

type RouteParams = { params: Promise<{ token: string }> };

// Borne défensive du corps de la requête entrante (endpoint public).
const MAX_BODY_BYTES = 100 * 1024; // 100 Ko

/**
 * Endpoint PUBLIC (non authentifié) du webhook entrant. L'automatisation est
 * résolue par son token secret (triggerConfig.token). Débit borné par les
 * quotas de executeAutomation (1/min, 100/h org). Le corps est injecté en
 * {{variables.body...}} pour les actions aval.
 *
 * Sécurité : token à forte entropie (Spec 1 §5, cf. webhook-inbound.ts), pas
 * de divulgation d'information sur les 404/403 (messages génériques), body
 * borné en taille et parsé défensivement (jamais évalué).
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;

  // Token attendu : hex 48 caractères (cf. generateWebhookToken). Rejet
  // immédiat d'un format invalide, sans toucher la BDD.
  if (!/^[0-9a-f]{48}$/.test(token)) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const [automation] = await db
    .select()
    .from(userDatabaseAutomations)
    .where(
      and(
        eq(userDatabaseAutomations.triggerType, "webhook_inbound"),
        sql`${userDatabaseAutomations.triggerConfig}->>'token' = ${token}`
      )
    )
    .limit(1);
  if (!automation) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const cfg = (automation.triggerConfig ?? {}) as { secret?: string };
  if (!verifyWebhookSecret(cfg, request.headers.get("x-webhook-secret"))) {
    // Message générique : ne pas distinguer "secret manquant" de "secret invalide".
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const automationsCfg = await getSetting<{ enabled?: boolean }>("automations");
  if (automationsCfg && automationsCfg.enabled === false) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  // Automatisme désactivé : jeton et secret valides, le corps est mémorisé (réponse de test
  // pour configurer la correspondance des champs) mais rien n'est exécuté.

  // Lecture bornée du corps : au-delà de MAX_BODY_BYTES, on tronque la lecture
  // sans jamais évaluer le contenu (défense contre un corps monstrueux).
  const rawText = await readBodyBounded(request, MAX_BODY_BYTES);
  if (rawText === null) {
    return NextResponse.json({ error: "Corps de requête trop volumineux" }, { status: 413 });
  }
  let body: unknown = {};
  if (rawText.length > 0) {
    try {
      body = JSON.parse(rawText);
    } catch {
      // Corps non-JSON ou invalide : on garde {} plutôt que de faire échouer
      // le déclenchement (le tiers peut légitimement envoyer un corps vide).
      body = {};
    }
  }

  // Automatisme lié à un formulaire Tally : une réponse d'un autre formulaire est
  // ignorée (ni déclencheur ni lastReceived), en 2xx pour que Tally ne relance pas.
  if (tallyFormIdMismatch(automation.triggerConfig, body)) {
    return NextResponse.json({ status: "ignored" });
  }

  // Dernier corps reçu (aide à la configuration). Secret déjà vérifié. Un échec
  // d'écriture ne doit jamais faire échouer la réception. Fusion atomique de la
  // seule clé lastReceived pour ne pas écraser jeton/secret.
  try {
    const lastReceived = buildLastReceived(body);
    await db
      .update(userDatabaseAutomations)
      .set({
        triggerConfig: sql`jsonb_set(coalesce(${userDatabaseAutomations.triggerConfig}, '{}'::jsonb), '{lastReceived}', ${JSON.stringify(lastReceived)}::jsonb)`,
      })
      .where(eq(userDatabaseAutomations.id, automation.id));
  } catch (e) {
    console.error("[hook] lastReceived non enregistré", e instanceof Error ? e.message : e);
  }

  if (!automation.enabled) {
    return NextResponse.json({ status: "received" }, { status: 202 });
  }

  // Corps de forme Tally : réserver la réponse avant d'exécuter, pour qu'un import
  // concurrent (ou une relivraison) ne la rejoue pas. Autres webhooks : inchangés.
  const responseId = tallyResponseIdFromBody(body);
  if (responseId && !(await reserveSubmission(automation.id, responseId, null))) {
    return NextResponse.json({ status: "duplicate" });
  }

  let result: Awaited<ReturnType<typeof executeAutomation>>;
  try {
    result = await executeAutomation(automation as AutomationRow, {
      event: "webhook_inbound",
      spaceId: automation.spaceId ?? undefined,
      databaseId: automation.databaseId ?? undefined,
      ...buildWebhookPayload(body, automation.triggerConfig),
    });
  } catch (e) {
    if (responseId) await releaseSubmission(automation.id, responseId).catch(() => {});
    throw e;
  }
  if (responseId) {
    if (result.status === "success" || result.status === "partial") {
      await markSubmissionDone(automation.id, responseId).catch(() => {});
    } else {
      // Échec ou quota : libérer pour que la relivraison de Tally puisse réussir.
      await releaseSubmission(automation.id, responseId).catch(() => {});
    }
  }

  if (result.status === "error") {
    // Pas de détail d'erreur interne exposé publiquement.
    return NextResponse.json({ status: "error" }, { status: 502 });
  }
  if (result.status === "skipped") {
    return NextResponse.json({ status: "skipped" }, { status: 429 });
  }
  return NextResponse.json({ status: "success" });
}

/**
 * Lit le corps de la requête en le bornant à `maxBytes`. Retourne `null` si le
 * corps dépasse la limite (le contenu au-delà n'est jamais parsé/évalué).
 */
async function readBodyBounded(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}
