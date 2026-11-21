import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  hasGlobalRole,
  canCrossOrgBoundary,
  INSTANCE_ADMIN_ONLY_MESSAGE,
} from "@/lib/auth/rbac";
import { encrypt } from "@/lib/crypto";
import { auditLog } from "@/lib/audit/log";
import { getClientIp } from "@/lib/rate-limit";
import { isPlainObject, mergeDepthForKey, mergeSettingValue } from "@/lib/settings/merge";
import { stripModuleToggleFields } from "@/lib/settings/module-toggles";
import {
  INFRASTRUCTURE_KEYS,
  maskSecrets,
  preserveExistingSecrets,
} from "@/lib/settings/secrets";

const VALID_KEYS = [
  "general",
  "auth",
  "smtp",
  "email",
  "ldap",
  "livekit",
  "collab",
  "rolePermissions",
  "whisper",
  "ollama",
  "ai_global",
  "ai_alerts",
  "backup_s3",
  "backup_schedule",
  "meeting_rooms_enabled",
  "automations",
] as const;

type SettingsKey = (typeof VALID_KEYS)[number];

function isValidKey(key: string): key is SettingsKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const instanceAdmin = canCrossOrgBoundary(user.globalRole);
  const rows = await db.select().from(systemSettings);

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    // La table `system_settings` porte aussi des clés qui n'appartiennent pas
    // à cet écran (jeton de licence, réglages de transcription, etc.). La
    // lecture se limite au périmètre déclaré, comme le fait déjà
    // /api/admin/ai/settings.
    if (!isValidKey(row.key)) continue;
    // AZ-08 : les réglages d'infrastructure ne sortent que pour
    // l'administration d'instance.
    if (INFRASTRUCTURE_KEYS.has(row.key) && !instanceAdmin) continue;
    // AZ-08 : et même pour elle, un secret ne se relit pas.
    settings[row.key] = maskSecrets(row.key, row.value);
  }

  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  // AZ-08 : refus ATOMIQUE dès qu'une clé d'infrastructure est présente et que
  // l'appelant n'administre pas l'instance. Rien n'est écrit, pas même les
  // clés licites du même corps : un enregistrement partiel laisserait croire
  // que le relais SMTP a bien été modifié. Le message est explicite, l'écran
  // d'administration l'affiche déjà tel quel dans sa notification d'erreur.
  if (!canCrossOrgBoundary(user.globalRole)) {
    const refused = Object.keys(body).filter((key) =>
      INFRASTRUCTURE_KEYS.has(key)
    );
    if (refused.length > 0) {
      return NextResponse.json(
        { error: INSTANCE_ADMIN_ONLY_MESSAGE, keys: refused },
        { status: 403 }
      );
    }
  }

  const now = new Date();

  // Champs chiffrés au repos : sous-ensemble de SECRET_FIELDS.
  const SENSITIVE_FIELDS: Record<string, string[]> = {
    ldap: ["ldapBindPassword"],
    email: ["smtpPassword", "resendApiKey"],
    smtp: ["smtpPassword"],
    backup_s3: ["s3BackupSecretKey"],
  };

  // Valeurs déjà stockées : base de la fusion (une clé absente du corps reçu
  // doit survivre à l'enregistrement d'une autre page d'administration).
  const existingRows = await db.select().from(systemSettings);
  const existingByKey = new Map<string, unknown>(
    existingRows.map((row) => [row.key, row.value])
  );

  const writtenKeys: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    if (!isValidKey(key)) continue;

    // Les interrupteurs de module ne s'écrivent que via /api/admin/modules/[id].
    const stripped = stripModuleToggleFields(key, value);
    if (stripped.skip) continue;

    const existing = existingByKey.get(key) ?? null;

    // Fusion AVANT chiffrement : les champs conservés depuis la base le sont
    // sous leur forme déjà chiffrée, et le garde-fou « déjà chiffré » plus bas
    // les laisse intacts. Chiffrer avant de fusionner re-chiffrerait ces
    // valeurs à chaque enregistrement.
    let processedValue = mergeSettingValue(existing, stripped.value, mergeDepthForKey(key));

    // Piège de l'aller-retour (AZ-08) : la lecture rend une sentinelle, et
    // l'écran d'administration la renvoie telle quelle au premier
    // enregistrement. Champ par champ, une valeur vide ou masquée n'écrase
    // JAMAIS le secret déjà en base, y compris quand ce secret n'est rangé que
    // sous la clé jumelle héritée (`smtp` pour `email`). Ce traitement couvre
    // TOUS les secrets, chiffrés au repos ou non (LiveKit).
    processedValue = preserveExistingSecrets(
      key,
      processedValue,
      stripped.value,
      existingByKey
    );

    // Chiffrement au repos, une fois les secrets préservés.
    const sensitiveKeys = SENSITIVE_FIELDS[key];
    if (sensitiveKeys && isPlainObject(processedValue)) {
      const merged: Record<string, unknown> = { ...processedValue };

      for (const field of sensitiveKeys) {
        const fieldValue = merged[field];
        if (typeof fieldValue === "string" && fieldValue.length > 0) {
          // Ne pas re-chiffrer si déjà chiffré (format iv:tag:cipher)
          if (!/^[0-9a-f]{32}:[0-9a-f]{32}:/.test(fieldValue)) {
            merged[field] = encrypt(fieldValue);
          }
        }
      }
      processedValue = merged;
    }

    await db
      .insert(systemSettings)
      .values({ key, value: processedValue, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: processedValue, updatedAt: now },
      });

    writtenKeys.push(key);
  }

  // Journal d'audit
  auditLog("settings.update", user.id, { keys: writtenKeys }, getClientIp(request));

  return NextResponse.json({ success: true });
}
