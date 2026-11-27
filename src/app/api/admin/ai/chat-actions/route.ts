import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import { auditLog } from "@/lib/audit/log";
import { getClientIp } from "@/lib/rate-limit";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import {
  DEFAULT_CHAT_ACTIONS,
  getStoredChatActionsSettings,
  saveChatActionsSettings,
} from "@/lib/ai/chat-actions-settings";

/**
 * Réglage « Actions de l'assistant IA » de l'organisation courante.
 * L'organisation vient uniquement de la session et du sous-domaine : le corps
 * n'en porte jamais (schéma strict). Une organisation non résolue ou interdite
 * rend 404 muet, jamais un accès aux autres organisations.
 */
const bodySchema = z
  .object({
    actionsEnabled: z.boolean(),
    readDatabases: z.boolean(),
    proposeUpdates: z.boolean(),
    proposeDeletes: z.boolean(),
    proposeMerges: z.boolean(),
    proposeCreates: z.boolean(),
    // Facultatifs tant que l'écran d'administration ne les envoie pas : défauts du réglage partagé.
    proposeSpreadsheets: z.boolean().default(DEFAULT_CHAT_ACTIONS.proposeSpreadsheets),
    proposeDocuments: z.boolean().default(DEFAULT_CHAT_ACTIONS.proposeDocuments),
    proposePresentations: z.boolean().default(DEFAULT_CHAT_ACTIONS.proposePresentations),
  })
  .strict();

type Scope = { orgId: string; error?: undefined } | { error: NextResponse; orgId?: undefined };

async function resolveScope(): Promise<Scope & { userId?: string }> {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return { error: NextResponse.json({ error: "Non autorisé" }, { status: 403 }) };
  }
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return { error: NextResponse.json({ error: "Organisation introuvable" }, { status: 404 }) };
  }
  return { orgId, userId: user.id };
}

export async function GET() {
  const scope = await resolveScope();
  if (scope.error) return scope.error;
  return NextResponse.json(await getStoredChatActionsSettings(scope.orgId!));
}

export async function PUT(request: NextRequest) {
  const scope = await resolveScope();
  if (scope.error) return scope.error;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  await saveChatActionsSettings(scope.orgId!, parsed.data);
  auditLog("settings.update", scope.userId!, { keys: ["chat_actions"], organizationId: scope.orgId, settings: parsed.data }, getClientIp(request));
  return NextResponse.json({ success: true, settings: parsed.data });
}
