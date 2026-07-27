import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { systemSettings, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";
import logger from "@/lib/logger";

/**
 * Comment l'accès a été accordé à une route /api/setup/*.
 * - "installer"   : le client détient le jeton d'installation de l'instance.
 * - "super_admin" : session authentifiée avec le rôle super_admin.
 */
export type SetupAccessMode = "installer" | "super_admin";

export type SetupAccess =
  | { allowed: true; mode: SetupAccessMode }
  | { allowed: false; response: NextResponse };

/** Clé system_settings portant le jeton d'installation. */
export const INSTALL_TOKEN_KEY = "setup_install_token";
/** Cookie déposé après présentation réussie du jeton. */
export const INSTALL_TOKEN_COOKIE = "setup_install_token";
const INSTALL_TOKEN_COOKIE_PATH = "/api/setup";
const INSTALL_TOKEN_COOKIE_MAX_AGE = 24 * 60 * 60; // 24 h

interface InstallTokenRecord {
  token: string;
  createdAt: string;
}

/** Anti-flood : le jeton n'est réaffiché dans les journaux qu'une fois par minute. */
const TOKEN_LOG_INTERVAL_MS = 60 * 1000;
let lastTokenLogAt = 0;
let lastConfigErrorLogAt = 0;

/** Longueur minimale d'un jeton fourni par l'exploitant. */
const MIN_CONFIGURED_TOKEN_LENGTH = 16;

/**
 * Jeton imposé par l'environnement (SETUP_INSTALL_TOKEN).
 *
 * Porte de secours pour qui n'a pas accès aux journaux du conteneur, et seule
 * façon d'automatiser une installation. Quand il est défini, rien n'est écrit
 * en base et rien n'est journalisé : le secret reste dans la configuration de
 * l'exploitant.
 */
function getConfiguredInstallToken(): string | null {
  const raw = process.env.SETUP_INSTALL_TOKEN?.trim();
  if (!raw) return null;

  if (raw.length < MIN_CONFIGURED_TOKEN_LENGTH) {
    // Cette fonction est appelée à chaque requête portant un cookie : sans
    // limite, une variable mal renseignée noierait les journaux.
    const now = Date.now();
    if (now - lastConfigErrorLogAt >= TOKEN_LOG_INTERVAL_MS) {
      lastConfigErrorLogAt = now;
      logger.error(
        "[setup] SETUP_INSTALL_TOKEN ignoré : %d caractères minimum requis",
        MIN_CONFIGURED_TOKEN_LENGTH
      );
    }
    return null;
  }

  return raw;
}

function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

async function readSetting<T>(key: string): Promise<T | null> {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, key))
    .limit(1);

  return (row?.value as T | undefined) ?? null;
}

/** Vrai si le drapeau system_settings.setup_completed est posé. */
export async function isSetupCompleted(): Promise<boolean> {
  return (await readSetting<unknown>("setup_completed")) === true;
}

/** Vrai dès qu'au moins un compte existe en base. */
export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return Boolean(row);
}

function logInstallToken(token: string, created: boolean): void {
  const now = Date.now();
  if (!created && now - lastTokenLogAt < TOKEN_LOG_INTERVAL_MS) return;
  lastTokenLogAt = now;

  logger.warn(
    "[setup] Jeton d'installation de cette instance, à saisir dans l'assistant de configuration : %s",
    token
  );
}

/**
 * Retourne le jeton d'installation, en le créant au premier appel.
 * Sans SETUP_INSTALL_TOKEN, il n'est diffusé que par les journaux du serveur :
 * la configuration initiale est ainsi réservée à qui a accès à la machine.
 */
export async function ensureInstallToken(): Promise<string> {
  const configured = getConfiguredInstallToken();
  if (configured) {
    // Jamais journalisé, jamais persisté : il vient déjà de l'exploitant.
    return configured;
  }

  const existing = await readSetting<InstallTokenRecord>(INSTALL_TOKEN_KEY);

  if (existing?.token) {
    logInstallToken(existing.token, false);
    return existing.token;
  }

  const record: InstallTokenRecord = {
    token: randomBytes(32).toString("base64url"),
    createdAt: new Date().toISOString(),
  };

  await db
    .insert(systemSettings)
    .values({ key: INSTALL_TOKEN_KEY, value: record, updatedAt: new Date() })
    .onConflictDoNothing();

  // Concurrence : si une autre requête a gagné la course, son jeton fait foi.
  const stored = await readSetting<InstallTokenRecord>(INSTALL_TOKEN_KEY);
  const token = stored?.token ?? record.token;
  logInstallToken(token, true);
  return token;
}

/** Compare un jeton candidat au jeton d'installation stocké. */
export async function verifyInstallToken(candidate: string): Promise<boolean> {
  if (!candidate) return false;

  const configured = getConfiguredInstallToken();
  if (configured) {
    // Le jeton d'environnement fait autorité : aucune lecture en base, donc
    // aucune trace du secret dans system_settings.
    return constantTimeEquals(candidate, configured);
  }

  const stored = await readSetting<InstallTokenRecord>(INSTALL_TOKEN_KEY);
  if (!stored?.token) return false;

  return constantTimeEquals(candidate, stored.token);
}

/** Vrai si la requête courante porte un cookie de jeton d'installation valide. */
export async function hasValidInstallToken(): Promise<boolean> {
  const cookieStore = await cookies();
  const presented = cookieStore.get(INSTALL_TOKEN_COOKIE)?.value;
  if (!presented) return false;

  return verifyInstallToken(presented);
}

/**
 * Supprime le jeton d'installation : révocation immédiate, côté serveur.
 * Un jeton imposé par SETUP_INSTALL_TOKEN ne peut pas être effacé ici ; il est
 * neutralisé par le drapeau setup_completed, que la garde teste en premier.
 */
export async function revokeInstallToken(): Promise<void> {
  await db.delete(systemSettings).where(eq(systemSettings.key, INSTALL_TOKEN_KEY));
}

/**
 * Pose le drapeau system_settings.setup_completed et révoque le jeton.
 * Partagé par /api/setup/complete et /api/setup/skip : les deux ferment le wizard.
 */
export async function markSetupCompleted(): Promise<void> {
  const now = new Date();
  await db
    .insert(systemSettings)
    .values({ key: "setup_completed", value: true, updatedAt: now })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: true, updatedAt: now },
    });

  await revokeInstallToken();
}

/**
 * Garde commune à toutes les routes /api/setup/*.
 *
 * Aucun accès anonyme : il faut soit le jeton d'installation de l'instance
 * (diffusé uniquement dans les journaux du serveur), soit une session
 * authentifiée avec le rôle super_admin. Une instance vierge n'est donc jamais
 * ouverte au premier venu, et le parcours reste possible de bout en bout pour
 * qui détient le jeton, y compris après la création des premiers comptes.
 *
 * À appeler en tête de chaque handler d'écriture /api/setup/*.
 */
export async function guardSetupAccess(): Promise<SetupAccess> {
  if (await isSetupCompleted()) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: "L'instance est déjà configurée" },
        { status: 403 }
      ),
    };
  }

  if (await hasValidInstallToken()) {
    return { allowed: true, mode: "installer" };
  }

  const user = await getSessionUser();
  if (!user) {
    return {
      allowed: false,
      response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
    };
  }

  if (!hasGlobalRole(user.globalRole, "super_admin")) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: "Accès refusé : réservé aux super administrateurs" },
        { status: 403 }
      ),
    };
  }

  return { allowed: true, mode: "super_admin" };
}

/** Mémorise le jeton d'installation validé pour la suite du parcours. */
export function setInstallTokenCookie(
  response: NextResponse,
  token: string
): NextResponse {
  response.cookies.set(INSTALL_TOKEN_COOKIE, token, {
    path: INSTALL_TOKEN_COOKIE_PATH,
    maxAge: INSTALL_TOKEN_COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return response;
}

/** Efface le cookie de jeton d'installation (fin ou abandon du parcours). */
export function clearInstallTokenCookie(response: NextResponse): NextResponse {
  response.cookies.set(INSTALL_TOKEN_COOKIE, "", {
    path: INSTALL_TOKEN_COOKIE_PATH,
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return response;
}
