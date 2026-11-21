import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { auditLog } from "@/lib/audit/log";
import { getClientIp } from "@/lib/rate-limit";
import { reloadBackupScheduler } from "@/lib/backup/scheduler";
import { mergeSettingValue } from "@/lib/settings/merge";
import { stripModuleToggleFields } from "@/lib/settings/module-toggles";
import { maskSecrets, preserveExistingSecrets } from "@/lib/settings/secrets";

export async function GET() {
  const user = await getSessionUser();
  // Portée instance : cette configuration pilote le dump PostgreSQL complet
  // de l'instance, tous tenants confondus. Aucun administrateur d'organisation
  // n'a à la régler (audit du 2026-08-19, AZ-07).
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  const [s3Row] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "backup_s3"));

  const [scheduleRow] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "backup_schedule"));

  return NextResponse.json({
    // ASVS V4.3 : la clé secrète du dépôt ne se relit pas. Le masquage passe
    // par le module partagé, comme /api/admin/settings, sans quoi les deux
    // routes rendraient deux vues contradictoires du MEME secret : l'une la
    // valeur brute, l'autre la sentinelle.
    s3: s3Row ? maskSecrets("backup_s3", s3Row.value) : null,
    schedule: scheduleRow?.value ?? { clientCron: "0 2 * * *", technicalCron: "0 3 * * *", enabled: false },
  });
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  // Portée instance : cette configuration pilote le dump PostgreSQL complet
  // de l'instance, tous tenants confondus. Aucun administrateur d'organisation
  // n'a à la régler (audit du 2026-08-19, AZ-07).
  if (!user || !hasGlobalRole(user.globalRole, "super_admin")) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const now = new Date();

  // Save S3 config
  if (body.s3) {
    // `backup_s3` est la toggleKey du module `backup` (entitlement `licensed`,
    // manageRole `super_admin`). L'interrupteur ne s'écrit QUE via
    // `PATCH /api/admin/modules/[id]`, seul endroit où licence, offre de
    // l'organisation, dépendances et rôle sont vérifiés. Sans ce filtre, un
    // simple admin activerait le module par cette page de configuration, et un
    // onglet ouvert avant l'activation la réécrirait à `false` en silence.
    const stripped = stripModuleToggleFields("backup_s3", body.s3);

    if (!stripped.skip) {
      const [existingRow] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, "backup_s3"));

      // Fusion AVANT chiffrement : les champs conservés depuis la base le sont
      // sous leur forme déjà chiffrée, et le garde-fou « déjà chiffré » plus bas
      // les laisse intacts (même ordre que /api/admin/settings).
      const merged = mergeSettingValue(existingRow?.value ?? null, stripped.value);

      // Piège de l'aller-retour : l'écran relit la configuration, reçoit la
      // sentinelle à la place de la clé secrète, puis réémet l'objet entier au
      // premier enregistrement. Sans cette passe, la valeur reçue écrasait le
      // secret réel et le dépôt de sauvegarde devenait inaccessible, en
      // silence. Même module partagé que /api/admin/settings, pour que les
      // deux routes n'aient qu'une seule règle.
      const preserved = preserveExistingSecrets(
        "backup_s3",
        merged,
        stripped.value,
        new Map<string, unknown>([["backup_s3", existingRow?.value ?? null]])
      );

      const s3Config: Record<string, unknown> =
        preserved && typeof preserved === "object" && !Array.isArray(preserved)
          ? { ...(preserved as Record<string, unknown>) }
          : {};

      // Encrypt secret key if not already encrypted
      const secretKey = s3Config.s3BackupSecretKey;
      if (
        typeof secretKey === "string" &&
        secretKey.length > 0 &&
        !/^[0-9a-f]{32}:[0-9a-f]{32}:/.test(secretKey)
      ) {
        s3Config.s3BackupSecretKey = encrypt(secretKey);
      }

      await db
        .insert(systemSettings)
        .values({ key: "backup_s3", value: s3Config, updatedAt: now })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: s3Config, updatedAt: now },
        });
    }
  }

  // Save schedule config
  if (body.schedule) {
    await db
      .insert(systemSettings)
      .values({ key: "backup_schedule", value: body.schedule, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: body.schedule, updatedAt: now },
      });
  }

  // Reload scheduler if schedule changed
  if (body.schedule) {
    await reloadBackupScheduler();
  }

  auditLog("backup.config.update", user.id, {}, getClientIp(request));

  return NextResponse.json({ success: true });
}
