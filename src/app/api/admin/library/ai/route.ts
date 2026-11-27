import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { canCrossOrgBoundary, hasGlobalRole } from "@/lib/auth/rbac";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { hasOrgMembershipRow } from "@/lib/org/resolve-request-org";
import { isOrgAdminOrOwner } from "@/lib/media/access";
import { backfillMediaIndex } from "@/lib/media/ai/backfill";
import { isEmbeddingConfiguredAsync } from "@/lib/ai/embeddings";
import { isTranscriptionEnabled } from "@/lib/meet/transcribe";
import { auditLog } from "@/lib/audit/log";
import { getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";
import {
  getMediaAiSettings,
  setMediaAiSettings,
  getMediaAiStats,
  clearMediaAiIndex,
  MediaAiSettingsError,
} from "@/lib/media/ai/settings";

const putSchema = z
  .object({ indexEnabled: z.boolean().optional(), transcribeEnabled: z.boolean().optional() })
  .strict()
  .refine((v) => v.indexEnabled !== undefined || v.transcribeEnabled !== undefined);

type Guard = { ok: true; userId: string; orgId: string } | { ok: false; res: NextResponse };

/**
 * Administrateur de l'organisation COURANTE uniquement : `super_admin`, ou membre réel
 * (`hasOrgMembershipRow`) admin global ou admin/owner de l'organisation. Une organisation
 * étrangère répond 404 muet, un membre simple 403.
 */
async function guard(): Promise<Guard> {
  const user = await getSessionUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Non authentifié" }, { status: 401 }) };
  let orgId: string;
  try {
    orgId = (await requireOrgScoped()).orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return { ok: false, res: e.response };
    throw e;
  }
  if (!canCrossOrgBoundary(user.globalRole)) {
    if (!(await hasOrgMembershipRow(user.id, orgId)))
      return { ok: false, res: NextResponse.json({ error: "Introuvable" }, { status: 404 }) };
    const admin = hasGlobalRole(user.globalRole, "admin") || (await isOrgAdminOrOwner(user.id, orgId));
    if (!admin) return { ok: false, res: NextResponse.json({ error: "Accès refusé" }, { status: 403 }) };
  }
  return { ok: true, userId: user.id, orgId };
}

export async function GET() {
  const g = await guard();
  if (!g.ok) return g.res;
  try {
    const [settings, embeddingConfigured, whisperAvailable, stats] = await Promise.all([
      getMediaAiSettings(g.orgId),
      isEmbeddingConfiguredAsync(),
      isTranscriptionEnabled(),
      getMediaAiStats(g.orgId),
    ]);
    return NextResponse.json({ ...settings, embeddingConfigured, whisperAvailable, ...stats });
  } catch (err) {
    logger.error({ err }, "Lecture des réglages IA de la médiathèque en échec");
    return NextResponse.json({ error: "Lecture impossible" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }
  const parsed = putSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Corps invalide" }, { status: 400 });

  try {
    if (
      (parsed.data.indexEnabled === true || parsed.data.transcribeEnabled === true) &&
      !(await isEmbeddingConfiguredAsync())
    ) {
      return NextResponse.json(
        { error: "Aucun fournisseur d'embedding n'est configuré pour l'instance." },
        { status: 409 },
      );
    }
    const previous = await getMediaAiSettings(g.orgId);
    const next = await setMediaAiSettings(g.orgId, g.userId, parsed.data);
    auditLog("media.ai.settings", g.userId, { organizationId: g.orgId, previous, next }, getClientIp(request));
    // Passage de désactivé à activé : l'existant (y compris après « Effacer l'index ») repart en file,
    // par lots et sans bloquer la réponse.
    if (!previous.indexEnabled && next.indexEnabled) void backfillMediaIndex(g.orgId);
    return NextResponse.json(next);
  } catch (err) {
    if (err instanceof MediaAiSettingsError) return NextResponse.json({ error: err.message }, { status: 400 });
    logger.error({ err }, "Écriture des réglages IA de la médiathèque en échec");
    return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const g = await guard();
  if (!g.ok) return g.res;
  try {
    const deleted = await clearMediaAiIndex(g.orgId);
    auditLog("media.ai.index_cleared", g.userId, { organizationId: g.orgId, deleted }, getClientIp(request));
    return NextResponse.json({ deleted });
  } catch (err) {
    logger.error({ err }, "Effacement de l'index IA de la médiathèque en échec");
    return NextResponse.json({ error: "Effacement impossible" }, { status: 500 });
  }
}
