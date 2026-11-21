import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { systemSettings } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import {
  hasGlobalRole,
  canCrossOrgBoundary,
  INSTANCE_ADMIN_ONLY_MESSAGE,
} from "@/lib/auth/rbac";
import { mergeDepthForKey, mergeSettingValue } from "@/lib/settings/merge";
import { stripModuleToggleFields } from "@/lib/settings/module-toggles";
import { INFRASTRUCTURE_KEYS, maskSecrets } from "@/lib/settings/secrets";

const AI_SETTINGS_KEYS = [
  "ai_global",
  "ai_alerts",
  "rolePermissions",
  "whisper",
  "ollama",
  "transcription",
  "voxtral",
  "help_assistant_enabled",
  "rerank",
] as const;

type AISettingsKey = (typeof AI_SETTINGS_KEYS)[number];

function isValidKey(key: string): key is AISettingsKey {
  return (AI_SETTINGS_KEYS as readonly string[]).includes(key);
}

/**
 * Porte dérobée sur le correctif AZ-08 (audit du 2026-08-19).
 *
 * Cet écran partage `whisper` et `ollama` avec /admin/system. Ces clés
 * sont classées INFRASTRUCTURE : elles portent l'URL de services
 * auto-hébergés partagés par toute l'instance, qu'un administrateur d'une
 * seule organisation pouvait ici relire, puis pointer vers son propre point
 * d'écoute. Tout ce que l'instance fait transcrire ou inférer y passait
 * ensuite, pour tous les tenants.
 *
 * La règle est donc exactement celle de /api/admin/settings, et la liste des
 * clés est IMPORTEE du module partagé `@/lib/settings/secrets` plutôt que
 * recopiée : lecture et écriture des
 * clés d'infrastructure réservées à l'administration d'instance. Cet écran en
 * porte quatre : `whisper`, `ollama`, `voxtral` (adresses de services
 * auto-hébergés) et `transcription` (le commutateur qui désigne le moteur de
 * transcription de toute l'instance, ainsi que son vocabulaire métier
 * partagé). Les autres clés (`ai_global`, `ai_alerts`, `rolePermissions`,
 * `help_assistant_enabled`, `rerank`) restent ouvertes au rôle `admin` : c'est
 * la configuration d'IA proprement dite, sans effet sur les services partagés.
 */
function isInfrastructureKey(key: string): boolean {
  return INFRASTRUCTURE_KEYS.has(key);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const instanceAdmin = canCrossOrgBoundary(user.globalRole);
  const rows = await db.select().from(systemSettings);

  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    if (!isValidKey(row.key)) continue;
    // AZ-08 : les réglages d'infrastructure ne sortent que pour
    // l'administration d'instance.
    if (isInfrastructureKey(row.key) && !instanceAdmin) continue;
    // AZ-08 : et même pour elle, un secret ne se relit pas. Aucune clé de cet
    // écran n'en porte aujourd'hui, l'appel garde la route alignée si l'une
    // d'elles vient à en porter un.
    settings[row.key] = maskSecrets(row.key, row.value);
  }

  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !hasGlobalRole(user.globalRole, "admin")) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const body = await request.json();

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Corps invalide" }, { status: 400 });
  }

  const instanceAdmin = canCrossOrgBoundary(user.globalRole);

  // AZ-08 : les clés d'infrastructure présentes dans le corps sont IGNOREES
  // pour qui n'administre pas l'instance, jamais écrites.
  //
  // Divergence assumée avec /api/admin/settings, qui refuse le corps entier en
  // 403 : cet écran renvoie systématiquement `whisper` et `ollama` à chaque
  // enregistrement, même intouchés. Un refus en bloc y interdirait donc à
  // l'administrateur d'organisation d'enregistrer quoi que ce soit, y compris
  // les réglages d'IA qui lui reviennent. Les clés ignorées sont rendues dans
  // la réponse pour que l'écran puisse le dire.
  const ignoredKeys: string[] = [];

  const now = new Date();

  // Valeurs déjà stockées : base de la fusion. Cette page et /admin/system
  // écrivent des clés communes (rolePermissions, whisper, ollama, ai_global) ;
  // sans fusion, enregistrer l'une écrase les champs gérés par l'autre.
  const existingRows = await db.select().from(systemSettings);
  const existingByKey = new Map<string, unknown>(
    existingRows.map((row) => [row.key, row.value])
  );

  for (const [key, value] of Object.entries(body)) {
    if (!isValidKey(key)) continue;

    if (isInfrastructureKey(key) && !instanceAdmin) {
      ignoredKeys.push(key);
      continue;
    }

    // Les interrupteurs de module ne s'écrivent que via /api/admin/modules/[id].
    const stripped = stripModuleToggleFields(key, value);
    if (stripped.skip) continue;

    const merged = mergeSettingValue(
      existingByKey.get(key) ?? null,
      stripped.value,
      mergeDepthForKey(key)
    );

    await db
      .insert(systemSettings)
      .values({ key, value: merged, updatedAt: now })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: merged, updatedAt: now },
      });
  }

  return NextResponse.json(
    ignoredKeys.length > 0
      ? { success: true, ignored: ignoredKeys, message: INSTANCE_ADMIN_ONLY_MESSAGE }
      : { success: true }
  );
}
