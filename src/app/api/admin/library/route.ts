import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, canCrossOrgBoundary, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { auditLog } from "@/lib/audit/log";
import { getClientIp } from "@/lib/rate-limit";
import logger from "@/lib/logger";
import {
  getLibrarySettings,
  setLibrarySettings,
  LibrarySettingsError,
  MIN_TRASH_RETENTION_DAYS,
  MAX_TRASH_RETENTION_DAYS,
} from "@/lib/media/library-settings";
import { getOrgStorageUsedBytes } from "@/lib/media/quota";
import { getHooks } from "@/lib/modules/hooks";
import { getLibraryStats } from "@/lib/media/list";

const patchSchema = z
  .object({
    trashRetentionDays: z.number().int().min(MIN_TRASH_RETENTION_DAYS).max(MAX_TRASH_RETENTION_DAYS),
  })
  .strict();

/**
 * Lecture : administrateur global, comptes de l'organisation courante.
 * Aucun nom de média ni de tag dans la réponse.
 * Écriture : le délai de purge est un réglage d'instance (`system_settings`),
 * donc réservé au super administrateur.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!hasGlobalRole(user.globalRole, "admin"))
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });

  let orgId: string;
  try {
    orgId = (await requireOrgScoped()).orgId;
  } catch (e) {
    if (e instanceof OrgScopeError) return e.response;
    throw e;
  }

  try {
    const [settings, usedBytes, limitBytes, stats] = await Promise.all([
      getLibrarySettings(),
      getOrgStorageUsedBytes(orgId),
      getHooks().usage.getOrgStorageLimitBytes(orgId),
      getLibraryStats(user, orgId),
    ]);
    const percent = limitBytes && limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 1000) / 10 : null;
    return NextResponse.json({
      settings,
      storage: { usedBytes, limitBytes, percent },
      counts: { media: stats.total, trash: stats.trash, orphan: stats.orphan, unused: stats.unused },
      canEdit: canCrossOrgBoundary(user.globalRole),
    });
  } catch (err) {
    logger.error({ err }, "Lecture de l'administration médiathèque en échec");
    return NextResponse.json({ error: "Lecture impossible" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  if (!canCrossOrgBoundary(user.globalRole))
    return NextResponse.json({ error: INSTANCE_ADMIN_ONLY_MESSAGE }, { status: 403 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: `Le délai de la corbeille doit être un entier entre ${MIN_TRASH_RETENTION_DAYS} et ${MAX_TRASH_RETENTION_DAYS} jours.`,
      },
      { status: 400 }
    );
  }

  try {
    const previous = await getLibrarySettings();
    const next = await setLibrarySettings(parsed.data);
    auditLog("media.settings", user.id, { previous, next }, getClientIp(request));
    return NextResponse.json({ settings: next });
  } catch (err) {
    if (err instanceof LibrarySettingsError) return NextResponse.json({ error: err.message }, { status: 400 });
    logger.error({ err }, "Écriture des réglages de la médiathèque en échec");
    return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
  }
}
